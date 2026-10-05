// Feasibility spike: render a settlement headlessly with the UNMODIFIED
// browser generator source and write a PNG.
//
// The point is to prove the risky assumption before any refactor is invested
// in -- that the existing ctx.* drawing code produces a faithful map under a
// native canvas. Run:  node src/spike.js [seed] [tier] [scale]

const fs = require('fs');
const path = require('path');
const { createCanvas } = require('@napi-rs/canvas');
const { createGeneratorContext } = require('./load-generators');

const OUT_DIR = path.resolve(__dirname, '..', 'out');
const FONT_DIR = path.resolve(__dirname, '..', 'fonts');

// The generators fire generate() without awaiting it, so there is no promise
// to hold. They do, however, call progress.done() as their very last act --
// so overriding showGenerationProgress yields an exact completion signal
// with no change to the generator source.
function installCompletionSignal(sandbox) {
  let resolveDone;
  const done = new Promise((resolve) => { resolveDone = resolve; });
  sandbox.showGenerationProgress = () => ({
    update() {},
    done() { resolveDone(); },
  });
  return done;
}

function makeContainerStub(canvas) {
  const named = {
    '#st-canvas': canvas,
    '#st-theme': { value: 'parchment', addEventListener() {}, innerHTML: '', appendChild() {} },
    '#st-heading': { textContent: '' },
    '#st-poi': { innerHTML: '' },
  };
  const generic = () => ({
    value: '', textContent: '', innerHTML: '', checked: false, style: {}, disabled: false,
    addEventListener() {}, appendChild() {}, querySelector: () => generic(),
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 0, height: 0 }),
  });
  return {
    innerHTML: '',
    querySelector: (sel) => named[sel] || generic(),
    querySelectorAll: () => [],
    appendChild() {},
    addEventListener() {},
  };
}

async function main() {
  const seed = parseInt(process.argv[2], 10) || 3;
  const tier = process.argv[3] || 'city';
  const scale = parseFloat(process.argv[4]) || 1;

  const { context, sandbox, loaded, fonts } = createGeneratorContext({ fontDir: FONT_DIR });
  console.log(`loaded ${loaded.length} generator files`);
  console.log(`registered ${fonts.length} font files${fonts.length ? ': ' + fonts.join(', ') : ' (none found -- label metrics will differ)'}`);

  const base = sandbox.SETTLEMENT_CANVAS_SIZE || 700;
  const canvas = createCanvas(Math.round(base * scale), Math.round(base * scale));
  // Scaling the context rather than the layout means the generator draws at
  // its normal coordinates and simply lands on more pixels -- a true
  // supersample, not a bigger town.
  if (scale !== 1) canvas.getContext('2d').scale(scale, scale);

  const doneSignal = installCompletionSignal(sandbox);
  const container = makeContainerStub(canvas);
  const params = new URLSearchParams({
    seed: String(seed), idx: '0', name: 'SpikeTown', tier,
  });

  const started = Date.now();
  sandbox.renderSettlementMap(container, params);
  await Promise.race([
    doneSignal,
    new Promise((_, reject) => setTimeout(() => reject(new Error('render timed out after 120s')), 120000)),
  ]);
  const elapsed = Date.now() - started;

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const outPath = path.join(OUT_DIR, `spike-${tier}-${seed}-${scale}x.png`);
  fs.writeFileSync(outPath, canvas.toBuffer('image/png'));
  console.log(`rendered ${tier} seed=${seed} at ${scale}x in ${elapsed}ms -> ${outPath}`);
}

main().catch((err) => {
  console.error('SPIKE FAILED:', err.message);
  if (err.stack) console.error(err.stack.split('\n').slice(1, 6).join('\n'));
  process.exit(1);
});
