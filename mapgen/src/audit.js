// Batch audit: render many seeds, check every one against RULES.md, and
// report. This is the check whose absence let a 55%-oversized building, a
// fully-buried street network and a uniform straw ground all ship.
//
//   node src/audit.js --type settlement --seeds 200 [--tier city] [--sheet]
//
// Exit code is non-zero if any HARD rule failed, so it can gate a release.

const fs = require('fs');
const path = require('path');
const { createCanvas } = require('@napi-rs/canvas');
const { renderMap, pixelsAtBaseScale } = require('./render');
const { evaluateSettlement, ENFORCED_RULE_IDS } = require('./rules');

const OUT_DIR = path.resolve(__dirname, '..', 'out');

function parseArgs(argv) {
  const args = { type: 'settlement', seeds: 25, tier: null, sheet: false, scale: 1, guide: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--type') args.type = argv[++i];
    else if (a === '--seeds') args.seeds = parseInt(argv[++i], 10);
    else if (a === '--tier') args.tier = argv[++i];
    else if (a === '--scale') args.scale = parseFloat(argv[++i]);
    else if (a === '--sheet') args.sheet = true;
    else if (a === '--guide') args.guide = true;
  }
  return args;
}

const TIERS = ['village', 'town', 'city'];

// A terrain backdrop like the one an overworld click threads through (64x48 height grid): a coastal landmass whose
// size, orientation and ruggedness vary with the seed, so a "--guide" audit covers the terrain-backed path the live
// app uses, not just the flat-ground fallback.
function syntheticGuide(seed) {
  const gw = 64, gh = 48, bytes = Buffer.alloc(gw * gh);
  const r = (k) => { const x = Math.sin(seed * 12.9898 + k * 78.233) * 43758.5453; return x - Math.floor(x); };
  const rx = 0.35 + r(1) * 0.3, ry = 0.4 + r(2) * 0.4, rot = r(3) * Math.PI, ph = r(4) * 6, wob = 0.1 + r(5) * 0.2;
  for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) {
    const u = x / gw - 0.5, v = y / gh - 0.5;
    const ur = u * Math.cos(rot) + v * Math.sin(rot), vr = -u * Math.sin(rot) + v * Math.cos(rot);
    let d = Math.hypot(ur / rx, vr / ry);
    d += wob * Math.sin(u * 9 + ph) + wob * 0.7 * Math.sin(v * 13 - ph);
    bytes[y * gw + x] = Math.max(0, Math.min(255, Math.round((0.78 - d * 0.42) * 255)));
  }
  return { guide: bytes.toString('base64'), gw: String(gw), gh: String(gh) };
}

async function main() {
  const args = parseArgs(process.argv);
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const runs = [];
  for (let i = 0; i < args.seeds; i++) {
    const seed = 1 + i;
    const tier = args.tier || TIERS[i % TIERS.length];
    runs.push({ seed, tier });
  }

  console.log(`auditing ${runs.length} ${args.type} renders against RULES.md\n`);

  const ruleStats = new Map();   // id -> {pass, fail, severity, samples[]}
  const failures = [];
  const thumbs = [];
  let totalMs = 0;

  for (let i = 0; i < runs.length; i++) {
    const { seed, tier } = runs[i];
    let rendered;
    try {
      rendered = await renderMap({
        type: args.type,
        scale: args.scale,
        params: Object.assign({ seed: String(seed), idx: '0', name: `Audit${seed}`, tier },
          args.guide ? Object.assign({ x: '400', y: '300', coastal: '1', h: '0.5', m: '0.5', sea: '0.42' }, syntheticGuide(seed)) : {}),
      });
    } catch (err) {
      failures.push({ seed, tier, rule: 'RENDER', detail: err.message });
      console.log(`  seed ${seed} (${tier}): RENDER FAILED -- ${err.message}`);
      continue;
    }
    totalMs += rendered.elapsedMs;

    const pixels = pixelsAtBaseScale(rendered.canvas, rendered.width, rendered.height, rendered.scale);
    const { results, hardFailures } = evaluateSettlement({
      trace: rendered.trace, pixels,
      width: rendered.width, height: rendered.height, tier,
    });

    for (const r of results) {
      if (!ruleStats.has(r.id)) ruleStats.set(r.id, { pass: 0, fail: 0, severity: r.severity, samples: [] });
      const st = ruleStats.get(r.id);
      r.pass ? st.pass++ : st.fail++;
      if (!r.pass && st.samples.length < 3) st.samples.push(`seed ${seed} (${tier}): ${r.detail}`);
    }
    for (const f of hardFailures) failures.push({ seed, tier, rule: f.id, detail: f.detail });

    const mark = hardFailures.length ? `FAIL [${hardFailures.map((f) => f.id).join(',')}]` : 'ok';
    console.log(`  seed ${seed} (${tier}): ${mark} ${rendered.elapsedMs}ms`);

    if (args.sheet && thumbs.length < 24) thumbs.push({ canvas: rendered.canvas, label: `${seed} ${tier}`, ok: !hardFailures.length });
  }

  console.log('\n--- rule summary ---');
  const ids = [...ruleStats.keys()].sort();
  for (const id of ids) {
    const st = ruleStats.get(id);
    const total = st.pass + st.fail;
    const pct = total ? ((st.pass / total) * 100).toFixed(0) : '0';
    const flag = st.fail === 0 ? ' ' : st.severity === 'hard' ? '!' : '~';
    console.log(`${flag} ${id.padEnd(4)} ${st.severity.padEnd(4)} ${String(st.pass).padStart(4)}/${String(total).padEnd(4)} (${pct}%)`);
    for (const s of st.samples) console.log(`        ${s}`);
  }

  // A rule that never reported is indistinguishable, in the table above, from
  // a rule that passed everything -- which is how C3 went missing on its first
  // run (its trace bucket was being dropped silently, so the check returned
  // null and simply wasn't listed). Absence is now called out explicitly.
  const silent = ENFORCED_RULE_IDS.filter((id) => !ruleStats.has(id));
  if (silent.length) {
    console.log(`\nNOT REPORTED (expected but silent): ${silent.join(', ')}`);
    console.log('  A rule that never runs is not a rule that passes -- check its inputs.');
  }

  const hardFailCount = failures.length;
  console.log(`\n${runs.length} renders, avg ${Math.round(totalMs / Math.max(1, runs.length))}ms`);
  console.log(hardFailCount ? `HARD FAILURES: ${hardFailCount}` : 'HARD FAILURES: none');

  if (args.sheet && thumbs.length) {
    const sheetPath = writeContactSheet(thumbs, args.type);
    console.log(`contact sheet -> ${sheetPath}`);
  }

  const reportPath = path.join(OUT_DIR, `audit-${args.type}.json`);
  fs.writeFileSync(reportPath, JSON.stringify({ runs: runs.length, failures, rules: Object.fromEntries(ruleStats) }, null, 2));
  console.log(`report -> ${reportPath}`);

  process.exit(hardFailCount ? 1 : 0);
}

// A grid of renders in one image, so a whole seed range can be judged at a
// glance instead of one export at a time -- which is how the defects that
// prompted all this went unnoticed for so long.
function writeContactSheet(thumbs, type) {
  const cols = 6, cell = 260, pad = 8, labelH = 18;
  const rows = Math.ceil(thumbs.length / cols);
  const sheet = createCanvas(cols * (cell + pad) + pad, rows * (cell + pad + labelH) + pad);
  const ctx = sheet.getContext('2d');
  ctx.fillStyle = '#14120f';
  ctx.fillRect(0, 0, sheet.width, sheet.height);
  ctx.font = '12px sans-serif';
  ctx.textBaseline = 'top';
  thumbs.forEach((t, i) => {
    const cx = pad + (i % cols) * (cell + pad);
    const cy = pad + Math.floor(i / cols) * (cell + pad + labelH);
    ctx.drawImage(t.canvas, cx, cy, cell, cell);
    ctx.fillStyle = t.ok ? '#8fc46a' : '#c0392b';
    ctx.fillText(`${t.ok ? '' : 'FAIL '}${t.label}`, cx, cy + cell + 3);
    ctx.strokeStyle = t.ok ? 'rgba(255,255,255,0.15)' : '#c0392b';
    ctx.lineWidth = t.ok ? 1 : 2;
    ctx.strokeRect(cx, cy, cell, cell);
  });
  const out = path.join(OUT_DIR, `contact-sheet-${type}.png`);
  fs.writeFileSync(out, sheet.toBuffer('image/png'));
  return out;
}

main().catch((err) => {
  console.error('AUDIT FAILED:', err.message, err.stack);
  process.exit(2);
});
