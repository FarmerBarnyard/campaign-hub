// Rule audit for town maps drawn the way the live app draws them: from the overworld's own world (lakes, real
// coast, biomes), every settlement of several overworlds. audit.js with --guide covers the height-guide fallback;
// this covers the path an overworld click-through now takes.
//
//   node src/audit-world.js [--worlds 3] [--continent]
//
// Exit code is non-zero if any HARD rule failed. Worlds are built once and reused across their settlements.

const path = require('path');
const { createCanvas } = require('@napi-rs/canvas');
const { createGeneratorContext } = require('./load-generators');
const { renderMap, pixelsAtBaseScale } = require('./render');
const { evaluateSettlement } = require('./rules');
const fs = require('fs');

const FONT_DIR = path.resolve(__dirname, '..', 'fonts');
const OUT_DIR = path.resolve(__dirname, '..', 'out');

async function main() {
  const worlds = parseInt((process.argv[process.argv.indexOf('--worlds') + 1]) || '3', 10) || 3;
  const continent = process.argv.includes('--continent');
  const seeds = [143792, 362610, 618949, 27, 9001].slice(0, worlds);
  const wpar = continent
    ? { oc: '150000', oo: '4', oi: '1', orv: '1', os: '12', ofb: '0', orb: '0', owz: '1', osc: 'c' }
    : { oc: '40000', oo: '4', oi: '1', orv: '1', os: '8', ofb: '0', orb: '0', owz: '1', osc: 's' };
  const W = continent ? 1600 : 800, H = continent ? 1200 : 600;
  const { sandbox } = createGeneratorContext({ fontDir: FONT_DIR });

  let hard = 0, count = 0, ms = 0;
  const failures = [], thumbs = [];
  const soft = new Map();
  for (const seed of seeds) {
    const world = sandbox.cachedOverworldWorld({ seed, cellCount: +wpar.oc, octaves: 4, island: true, seaLevel: 0.42, riversOn: true, settleCount: +wpar.os }, W, H);
    for (let i = 0; i < world.settlements.length; i++) {
      const s = world.settlements[i];
      const params = Object.assign({ seed: String(seed), idx: String(i), name: s.name, tier: s.tier, x: String(Math.round(s.x)), y: String(Math.round(s.y)), h: '0.45', m: '0.5', sea: '0.42', coastal: '1' }, wpar);
      const r = await renderMap({ type: 'settlement', scale: 1, params });
      const pixels = pixelsAtBaseScale(r.canvas, r.width, r.height, r.scale);
      const ev = evaluateSettlement({ trace: r.trace, pixels, width: r.width, height: r.height, tier: s.tier });
      count++; ms += r.elapsedMs;
      for (const f of ev.hardFailures) { hard++; failures.push(`world ${seed} ${s.name} (${s.tier}): ${f.id} ${f.detail}`); }
      for (const x of ev.results) if (x.severity !== 'hard' && !x.pass) soft.set(x.id, (soft.get(x.id) || 0) + 1);
      if (thumbs.length < 24) thumbs.push({ canvas: r.canvas, label: `${seed} ${s.name} ${s.tier}` });
      process.stdout.write(`  world ${seed} ${s.name} (${s.tier}): ${ev.hardFailures.length ? 'HARD ' + ev.hardFailures.map((f) => f.id).join(',') : 'ok'} ${r.elapsedMs}ms\n`);
    }
  }
  console.log(`\n${count} town maps, avg ${Math.round(ms / count)} ms; soft misses: ${[...soft].map(([k, v]) => `${k}:${v}`).join(' ') || 'none'}`);
  failures.slice(0, 20).forEach((f) => console.log('  FAIL ' + f));
  console.log(hard ? `HARD FAILURES: ${hard}` : 'HARD FAILURES: none');

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const cols = 6, tw = 260, th = 260, rows = Math.ceil(thumbs.length / cols);
  const sheet = createCanvas(cols * tw, rows * th + 0), c = sheet.getContext('2d');
  thumbs.forEach((t, i) => c.drawImage(t.canvas, (i % cols) * tw, Math.floor(i / cols) * th, tw, th));
  fs.writeFileSync(path.join(OUT_DIR, 'contact-sheet-world.png'), sheet.toBuffer('image/png'));
  process.exit(hard ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
