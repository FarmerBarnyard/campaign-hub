// The map generation service.
//
// One job: turn {type, params} into a validated PNG. Everything about auth,
// CORS, rate limiting and caching lives in the Cloudflare Worker in front of
// this -- the service is reached only over the Access-gated tunnel and binds
// loopback, so it deliberately has no auth of its own and must never be
// exposed directly.
//
// The rule pass is the point of the whole exercise. A render that violates a
// HARD rule is not served; the layout is re-rolled (internal streams only --
// never the campaign's seed) and checked again. If every attempt fails, the
// best one is served anyway with its violations attached, because a map with
// a flaw is still more useful than an error page, and the violation is now
// recorded rather than silently shipped.

const http = require('http');
const { createCanvas } = require('@napi-rs/canvas');
const { renderMap, pixelsAtBaseScale } = require('./render');
const { evaluateSettlement } = require('./rules');

const HOST = process.env.MAPGEN_HOST || '127.0.0.1';
const PORT = parseInt(process.env.MAPGEN_PORT, 10) || 8791;

// Bumped whenever the art changes. It is part of the Worker's cache key, so
// bumping it is what retires every cached map at once -- without it, an art
// fix would be invisible to anyone whose map was already generated.
const GENERATOR_VERSION = '1';

const TYPES = new Set(['settlement', 'dungeon', 'detail', 'landmark', 'overworld']);
// Only these reach the generators. An allow-list rather than a block-list:
// params are forwarded into generator code, so anything unrecognised is
// dropped rather than trusted.
const ALLOWED_PARAMS = new Set([
  'seed', 'idx', 'name', 'tier', 'x', 'y', 'kind', 'biome', 'theme', 'variant',
  // Overworld generation controls (see makeOverworldStubs in render.js) --
  // the only way to drive that generator headlessly, since it reads these
  // straight off browser form controls with no params argument of its own.
  'cells', 'octaves', 'sea', 'forestBias', 'ruggedBias', 'island', 'rivers',
  'wildzones', 'legend', 'settle', 'tileCols', 'tileRows',
]);

const MAX_BODY_BYTES = 16 * 1024;   // a params object, nothing more
const MAX_SCALE = 4;
const MAX_CONCURRENT = 2;           // canvas renders are CPU-bound; keep headroom on the VM
const MAX_QUEUED = 16;
const MAX_RULE_RETRIES = 3;

// ---------------------------------------------------------------- queueing

let active = 0;
const queue = [];
const inFlight = new Map();         // key -> promise, so duplicate requests share one render
const recentRenders = new Map();          // key -> { value, expires }: recent renders, so the Worker's per-part requests share one
const RESULT_TTL_MS = 120 * 1000;
const RESULT_CACHE_MAX = 3;         // a scale-4 canvas is tens of MB of pixels; keep very few
const PNG_PARTS = new Set(['display', 'master', 'meta']);

function runQueued(fn) {
  return new Promise((resolve, reject) => {
    if (active >= MAX_CONCURRENT && queue.length >= MAX_QUEUED) {
      const err = new Error('busy');
      err.code = 'busy';
      return reject(err);
    }
    const task = () => {
      active++;
      Promise.resolve()
        .then(fn)
        .then(resolve, reject)
        .finally(() => {
          active--;
          const next = queue.shift();
          if (next) next();
        });
    };
    if (active < MAX_CONCURRENT) task();
    else queue.push(task);
  });
}

// --------------------------------------------------------------- rendering

function evaluate(type, rendered, tier) {
  if (type !== 'settlement') return { results: [], hardFailures: [] };
  const pixels = pixelsAtBaseScale(rendered.canvas, rendered.width, rendered.height, rendered.scale);
  return evaluateSettlement({
    trace: rendered.trace, pixels,
    width: rendered.width, height: rendered.height, tier,
  });
}

// Renders, checks, and re-rolls the internal layout on a hard violation.
async function renderValidated({ type, params, scale, theme }) {
  let best = null;
  for (let variant = 0; variant <= MAX_RULE_RETRIES; variant++) {
    const attemptParams = variant ? { ...params, variant: String(variant) } : params;
    const rendered = await renderMap({ type, params: attemptParams, scale, theme, trace: true });
    const { results, hardFailures } = evaluate(type, rendered, params.tier);
    const attempt = { rendered, results, hardFailures, variant };
    if (!hardFailures.length) return attempt;
    // Keep whichever attempt broke the fewest rules, so the fallback is the
    // least-bad map rather than simply the last one tried.
    if (!best || hardFailures.length < best.hardFailures.length) best = attempt;
  }
  console.warn(
    `[mapgen] served with violations after ${MAX_RULE_RETRIES} retries: ` +
    best.hardFailures.map((f) => f.id).join(',')
  );
  return best;
}

// The master is a true supersample: same drawing coordinates, more pixels.
// The display copy is downscaled from it rather than rendered again, so the
// two can never disagree about what the map looks like.
function downscale(canvas, w, h) {
  const out = createCanvas(w, h);
  out.getContext('2d').drawImage(canvas, 0, 0, w, h);
  return out;
}

async function handleRender(body) {
  const type = String(body.type || '');
  if (!TYPES.has(type)) throw badRequest('unknown map type');

  const scale = Math.min(MAX_SCALE, Math.max(1, Number(body.scale) || 1));
  const theme = typeof body.theme === 'string' ? body.theme.slice(0, 40) : 'parchment';

  const params = {};
  for (const [k, v] of Object.entries(body.params || {})) {
    if (!ALLOWED_PARAMS.has(k)) continue;
    if (v === null || v === undefined) continue;
    params[k] = String(v).slice(0, 200);
  }
  // A caller must not be able to pin the retry variant: it exists so the
  // service can re-roll a bad layout, and letting a URL choose it would make
  // the same link render different maps.
  delete params.variant;

  const wantMaster = body.parts ? body.parts.includes('master') : true;
  const wantDisplay = body.parts ? body.parts.includes('display') : true;

  // Binary mode: the Worker asks for one part at a time and streams the PNG
  // straight into R2 -- a base64-in-JSON master at scale 4 would be larger
  // than a Worker should hold. Rendering is the expensive step, so all three
  // parts of one (type, params, scale, theme) share a single render through
  // the short-lived result cache below.
  const format = body.format === 'png' ? 'png' : 'json';
  const part = format === 'png' ? String(body.part || 'display') : null;
  if (part && !PNG_PARTS.has(part)) throw badRequest('unknown part');

  const renderKey = JSON.stringify([GENERATOR_VERSION, type, scale, theme, params]);
  const rendered = await renderShared(renderKey, { type, params, scale, theme });

  if (format === 'png') {
    if (part === 'meta') return { kind: 'json', payload: summary(rendered, type) };
    const buf = part === 'master' ? rendered.masterPng() : rendered.displayPng();
    return { kind: 'png', buf, summary: summary(rendered, type) };
  }

  const payload = summary(rendered, type);
  if (wantMaster) {
    payload.master = { width: rendered.canvas.width, height: rendered.canvas.height, png: rendered.masterPng().toString('base64') };
  }
  if (wantDisplay) {
    const d = rendered.displayCanvas();
    payload.display = { width: d.width, height: d.height, png: rendered.displayPng().toString('base64') };
  }
  return { kind: 'json', payload };
}

function summary(r, type) {
  return {
    ok: true,
    generatorVersion: GENERATOR_VERSION,
    type,
    variant: r.variant,
    meta: r.meta,
    width: r.width,
    height: r.height,
    elapsedMs: r.elapsedMs,
    rules: r.rules,
    violations: r.violations,
  };
}

// Renders once and keeps the result for RESULT_TTL_MS so the Worker's
// follow-up part requests (display, then master, then meta) don't each pay
// for a fresh render. Duplicate concurrent requests share the in-flight
// promise; only the newest RESULT_CACHE_MAX results are retained, and PNG
// encoding is lazy so a request for one part never encodes the other.
async function renderShared(key, { type, params, scale, theme }) {
  const hit = recentRenders.get(key);
  if (hit && hit.expires > Date.now()) return hit.value;
  if (inFlight.has(key)) return inFlight.get(key);

  const work = runQueued(async () => {
    const started = Date.now();
    const { rendered, results: ruleResults, hardFailures, variant } = await renderValidated({ type, params, scale, theme });
    const memo = {};
    const value = {
      canvas: rendered.canvas,
      meta: rendered.meta,
      width: rendered.width,
      height: rendered.height,
      variant,
      elapsedMs: Date.now() - started,
      rules: ruleResults.map((r) => ({ id: r.id, severity: r.severity, pass: r.pass, detail: r.detail })),
      violations: hardFailures.map((f) => ({ id: f.id, detail: f.detail })),
      displayCanvas() {
        if (!memo.display) memo.display = scale === 1 ? rendered.canvas : downscale(rendered.canvas, rendered.width, rendered.height);
        return memo.display;
      },
      displayPng() {
        if (!memo.displayPng) memo.displayPng = this.displayCanvas().toBuffer('image/png');
        return memo.displayPng;
      },
      masterPng() {
        if (!memo.masterPng) memo.masterPng = rendered.canvas.toBuffer('image/png');
        return memo.masterPng;
      },
    };
    recentRenders.set(key, { value, expires: Date.now() + RESULT_TTL_MS });
    while (recentRenders.size > RESULT_CACHE_MAX) recentRenders.delete(recentRenders.keys().next().value);
    return value;
  }).finally(() => inFlight.delete(key));

  inFlight.set(key, work);
  return work;
}

function badRequest(msg) {
  const err = new Error(msg);
  err.code = 'bad_request';
  return err;
}

// ------------------------------------------------------------------ server

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY_BYTES) {
        reject(badRequest('body too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); }
      catch { reject(badRequest('invalid JSON')); }
    });
    req.on('error', reject);
  });
}

function sendPng(res, buf, sum) {
  // Small summary in a header so the Worker can record variant/violations
  // without a second round trip; the full rule list comes from part=meta.
  const compact = Buffer.from(JSON.stringify({
    generatorVersion: sum.generatorVersion, variant: sum.variant,
    width: sum.width, height: sum.height, violations: sum.violations.map((v) => v.id),
  })).toString('base64');
  res.writeHead(200, {
    'Content-Type': 'image/png',
    'Content-Length': buf.length,
    'X-Content-Type-Options': 'nosniff',
    'X-Mapgen-Summary': compact,
  });
  res.end(buf);
}

function send(res, status, obj) {
  const buf = Buffer.from(JSON.stringify(obj));
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': buf.length,
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(buf);
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    return send(res, 200, { ok: true, generatorVersion: GENERATOR_VERSION, active, queued: queue.length });
  }
  if (req.method !== 'POST' || req.url !== '/render') {
    return send(res, 404, { ok: false, error: 'not_found' });
  }
  try {
    const body = await readBody(req);
    const out = await handleRender(body);
    if (out.kind === 'png') sendPng(res, out.buf, out.summary);
    else send(res, 200, out.payload);
  } catch (err) {
    // Error codes, never err.message: this response crosses the tunnel to the
    // Worker and on to a browser, and generator internals are not the
    // client's business (same convention as the Worker's own routes).
    const code = err.code === 'bad_request' ? 400 : err.code === 'busy' ? 503 : 500;
    if (code === 500) console.error('[mapgen] render failed:', err);
    send(res, code, { ok: false, error: err.code === 'busy' ? 'busy' : err.code === 'bad_request' ? 'bad_request' : 'render_failed' });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`[mapgen] listening on http://${HOST}:${PORT} (generator v${GENERATOR_VERSION})`);
});
