// Gate for the server-rendered map types that have no RULES.md checks of their own (detail, zoom window,
// landmark, dungeon). Settlement has the rule audit (audit.js); these types are held to a plainer bar, run
// across many seeds before each is allowed to be switched on in the hub:
//
//   node src/audit-types.js --type dungeon --seeds 40 [--sheet]
//   node src/audit-types.js --type all --seeds 20
//
// For every seed it checks that the render
//   - finishes without throwing and inside the time limit,
//   - is not blank (enough distinct colours and enough pixels that differ from the corner colour),
//   - is deterministic (the first seeds are rendered twice and the PNG bytes compared), and
//   - leaves the panels the browser needs once it stops generating locally (the dungeon's room key,
//     the landmark's lore) non-empty.
// Exit code is non-zero if any seed fails, so it can gate a release. --sheet writes a contact sheet.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { createCanvas } = require('@napi-rs/canvas');
const { renderMap } = require('./render');

const OUT_DIR = path.resolve(__dirname, '..', 'out');
const TIME_LIMIT_MS = 60000;
const DETERMINISM_CHECKS = 3;
const TYPES = ['dungeon', 'landmark', 'detail', 'window'];

const BIOMES = ['plains', 'forest', 'hills', 'mountains', 'swamp', 'snow', 'barrens', 'steppe'];
const SITES = ['leyLineNexus', 'astralScar', 'giantsGarden', 'sunkenRuins'];
const ZONES = ['', 'ashenForest', 'fungalForest', 'saltFlats', 'frostfell', 'boneMarsh', ''];

function parseArgs(argv) {
  const args = { type: 'all', seeds: 20, sheet: false };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--type') args.type = argv[++i];
    else if (argv[i] === '--seeds') args.seeds = parseInt(argv[++i], 10);
    else if (argv[i] === '--sheet') args.sheet = true;
  }
  return args;
}

// The request a person's click would make, varied by seed so the sweep covers the biomes, wild zones and
// sites rather than one lucky combination.
function requestFor(type, i) {
  const seed = String(1 + i);
  const biome = BIOMES[i % BIOMES.length];
  if (type === 'dungeon') {
    const sizes = [['60', '40'], ['40', '30'], ['80', '50']];
    const [dw, dh] = sizes[i % sizes.length];
    return { type: 'dungeon', params: { seed, dw, dh, dmin: String(5 + (i % 3)), ddepth: String(4 + (i % 3)), legend: i % 2 ? '1' : '0' } };
  }
  if (type === 'landmark') {
    return { type: 'landmark', params: { seed, x: String(100 + i * 37 % 600), y: String(80 + i * 53 % 400), biome, h: '0.5', m: '0.5', sea: '0.42', zone: ZONES[i % ZONES.length], poi: SITES[i % SITES.length], poiLabel: 'Landmark', poiName: `Audit site ${seed}` } };
  }
  if (type === 'detail') {
    return { type: 'detail', params: { seed, x: String(100 + i * 41 % 600), y: String(80 + i * 47 % 400), biome, h: '0.5', m: '0.5', sea: '0.42', zone: ZONES[i % ZONES.length] } };
  }
  // A standard (non-continent) zoom window; the position moves with the seed.
  return { type: 'detail', params: { seed, oc: '40000', oo: '4', oi: '1', orv: '1', os: '6', sea: '0.42', ofb: '0', orb: '0', owz: '1', osc: 's', wx: String(0.1 + (i % 5) * 0.12), wy: String(0.1 + (i % 4) * 0.15), ww: String(0.2 + (i % 3) * 0.05) } };
}

// Distinct colours (sampled) and the share of pixels unlike the top-left corner: a blank or near-blank map
// fails both.
function inkOf(canvas) {
  const w = canvas.width, h = canvas.height;
  const data = canvas.getContext('2d').getImageData(0, 0, w, h).data;
  const seen = new Set();
  const cr = data[0], cg = data[1], cb = data[2];
  let differing = 0, total = 0;
  for (let y = 0; y < h; y += 4) {
    for (let x = 0; x < w; x += 4) {
      const o = (y * w + x) * 4;
      seen.add(((data[o] >> 3) << 10) | ((data[o + 1] >> 3) << 5) | (data[o + 2] >> 3));
      if (Math.abs(data[o] - cr) + Math.abs(data[o + 1] - cg) + Math.abs(data[o + 2] - cb) > 24) differing++;
      total++;
    }
  }
  return { colours: seen.size, differing: differing / total };
}

const hash = (buf) => crypto.createHash('sha256').update(buf).digest('hex').slice(0, 16);

async function auditType(type, count, sheet) {
  const label = type;
  console.log(`\n${label}: ${count} renders`);
  const failures = [];
  const times = [];
  const thumbs = [];
  for (let i = 0; i < count; i++) {
    const req = requestFor(type, i);
    const tag = `seed ${req.params.seed}`;
    let r;
    try {
      r = await renderMap({ ...req, scale: 1, trace: false });
    } catch (e) {
      failures.push(`${tag}: threw ${e.message}`);
      continue;
    }
    times.push(r.elapsedMs);
    if (r.elapsedMs > TIME_LIMIT_MS) failures.push(`${tag}: took ${r.elapsedMs} ms`);
    const ink = inkOf(r.canvas);
    if (ink.colours < 12 || ink.differing < 0.05) failures.push(`${tag}: looks blank (${ink.colours} colours, ${(ink.differing * 100).toFixed(1)}% inked)`);
    if (type === 'dungeon' && !(r.meta.roomKey || '').includes('key-room')) failures.push(`${tag}: no room key`);
    if (type === 'landmark' && !(r.meta.lore || '').trim()) failures.push(`${tag}: no lore panel`);
    const png = r.canvas.toBuffer('image/png');
    if (i < DETERMINISM_CHECKS) {
      const again = await renderMap({ ...req, scale: 1, trace: false });
      if (hash(again.canvas.toBuffer('image/png')) !== hash(png)) failures.push(`${tag}: not deterministic`);
    }
    if (sheet && i < 12) thumbs.push(r.canvas);
  }
  times.sort((a, b) => a - b);
  const pick = (q) => times.length ? times[Math.min(times.length - 1, Math.floor(times.length * q))] : 0;
  console.log(`  ${count - failures.length} ok, ${failures.length} failed; time median ${pick(0.5)} ms, p95 ${pick(0.95)} ms, max ${pick(1)} ms`);
  for (const f of failures.slice(0, 20)) console.log(`  FAIL ${f}`);

  if (sheet && thumbs.length) {
    const cols = 4, tw = 400, th = 300;
    const rows = Math.ceil(thumbs.length / cols);
    const out = createCanvas(cols * tw, rows * th);
    const octx = out.getContext('2d');
    thumbs.forEach((c, i) => octx.drawImage(c, (i % cols) * tw, Math.floor(i / cols) * th, tw, th));
    fs.mkdirSync(OUT_DIR, { recursive: true });
    const file = path.join(OUT_DIR, `sheet-${type}.png`);
    fs.writeFileSync(file, out.toBuffer('image/png'));
    console.log(`  contact sheet: ${file}`);
  }
  return failures.length;
}

async function main() {
  const args = parseArgs(process.argv);
  const types = args.type === 'all' ? TYPES : [args.type];
  for (const t of types) if (!TYPES.includes(t)) { console.error(`unknown type ${t}; use ${TYPES.join('|')}|all`); process.exit(2); }
  let failed = 0;
  for (const t of types) failed += await auditType(t, args.seeds, args.sheet);
  console.log(failed ? `\n${failed} failure(s)` : '\nall passed');
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
