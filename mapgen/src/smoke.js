// End-to-end smoke test against a RUNNING mapgen service (same container:
//   docker compose exec mapgen node src/smoke.js).
// Covers what the batch audit can't: the HTTP surface the Worker uses (PNG
// parts, shared result cache, input rejection) and the terrain-guide path an
// overworld click produces, including a coastal settlement.

const http = require('http');
const assert = require('assert/strict');

const PORT = parseInt(process.env.MAPGEN_PORT, 10) || 8791;

function post(body) {
  return new Promise((resolve, reject) => {
    const data = Buffer.from(JSON.stringify(body));
    const req = http.request({ host: '127.0.0.1', port: PORT, path: '/render', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': data.length } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    req.end(data);
  });
}

const isPng = (b) => b.length > 8 && b.readUInt32BE(0) === 0x89504e47;
const json = (r) => JSON.parse(r.body.toString('utf8'));

// A 64x48 height grid shaped like the overworld's: sea on the left rising to
// land, so the settlement sits on a coast. Same size/encoding as
// buildGuideParams in views/map-overworld.js.
function syntheticGuide() {
  const w = 64, h = 48, bytes = Buffer.alloc(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    bytes[y * w + x] = Math.max(0, Math.min(255, Math.round(60 + (x / w) * 190 + Math.sin(y / 5) * 12)));
  }
  return { guide: bytes.toString('base64'), gw: '64', gh: '48' };
}

let passed = 0;
async function t(name, fn) {
  const started = Date.now();
  await fn();
  passed++;
  console.log(`ok - ${name} (${Date.now() - started}ms)`);
}

(async () => {
  const base = { type: 'settlement', params: { seed: '7', idx: '2', name: 'Smoke', tier: 'town' } };

  await t('png display: valid PNG, summary header, no base64 JSON', async () => {
    const r = await post({ ...base, format: 'png', part: 'display' });
    assert.equal(r.status, 200);
    assert.equal(r.headers['content-type'], 'image/png');
    assert.ok(isPng(r.body), 'body is a PNG');
    const sum = JSON.parse(Buffer.from(r.headers['x-mapgen-summary'], 'base64').toString());
    assert.equal(sum.width, 700);
    assert.ok(Array.isArray(sum.violations));
    console.log(`   display ${r.body.length} bytes`);
  });

  await t('parts share one render: master + meta are fast after display', async () => {
    const withScale = { ...base, scale: 2 };
    const t0 = Date.now();
    const d = await post({ ...withScale, format: 'png', part: 'display' });
    const first = Date.now() - t0;
    const t1 = Date.now();
    const m = await post({ ...withScale, format: 'png', part: 'master' });
    const meta = await post({ ...withScale, format: 'png', part: 'meta' });
    const rest = Date.now() - t1;
    assert.ok(isPng(d.body) && isPng(m.body));
    assert.ok(m.body.length > d.body.length, 'master is the larger image');
    const info = json(meta);
    assert.equal(info.ok, true);
    assert.equal(info.width, 700);
    assert.ok(info.meta && typeof info.meta.poi === 'string', 'meta carries the notable-locations panel');
    assert.ok(rest < first, `follow-up parts (${rest}ms) should cost less than the render (${first}ms)`);
    console.log(`   render ${first}ms, master+meta ${rest}ms, master ${m.body.length} bytes`);
  });

  await t('terrain guide + coastal: renders and differs from flat ground', async () => {
    const g = syntheticGuide();
    const guided = { ...base, params: { ...base.params, x: '350', y: '350', h: '0.45', m: '0.5', sea: '0.42', coastal: '1', zoom: '3', ...g } };
    const a = await post({ ...guided, format: 'png', part: 'display' });
    const b = await post({ ...base, format: 'png', part: 'display' });
    assert.equal(a.status, 200);
    assert.ok(isPng(a.body));
    assert.notDeepEqual(a.body, b.body, 'the guide must change the render');
    const sum = JSON.parse(Buffer.from(a.headers['x-mapgen-summary'], 'base64').toString());
    console.log(`   guided violations: ${sum.violations.length ? sum.violations.join(',') : 'none'}`);
  });

  await t('same request twice is deterministic', async () => {
    const a = await post({ ...base, format: 'png', part: 'display' });
    const b = await post({ ...base, format: 'png', part: 'display' });
    assert.deepEqual(a.body, b.body);
  });

  await t('rejects bad input without leaking detail', async () => {
    const bad = [
      { ...base, type: 'nope' },
      { ...base, format: 'png', part: 'bogus' },
      { ...base, params: { ...base.params, guide: 'A'.repeat(5000) } },
      { ...base, params: { ...base.params, guide: '<script>' } },
    ];
    for (const b of bad) {
      const r = await post(b);
      assert.equal(r.status, 400, JSON.stringify(b).slice(0, 60));
      assert.deepEqual(json(r), { ok: false, error: 'bad_request' });
    }
  });

  await t('variant cannot be pinned by the caller', async () => {
    const a = await post({ ...base, params: { ...base.params, variant: '3' }, format: 'png', part: 'display' });
    const b = await post({ ...base, format: 'png', part: 'display' });
    assert.deepEqual(a.body, b.body);
  });

  console.log(`\n${passed} smoke tests passed`);
})().catch((err) => {
  console.error('SMOKE FAILED:', err.message);
  process.exit(1);
});
