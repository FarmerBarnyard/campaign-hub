// The design agent.
//
// The deterministic rules in rules.js are fast, free and reproducible, and
// they only ever catch what somebody already thought to encode. Everything
// that actually got these maps rejected -- "every settlement is a circular
// blob", "the castle reads as a sticker", "buildings are scattered like
// confetti" -- was invisible to them, because no rule described it. Those were
// found by a person looking at a sheet of maps. This automates that look.
//
// It is deliberately NOT in the render path. A vision model costs money and
// seconds per call and does not return the same answer twice, so using it as a
// per-map gate would make renders slow, expensive and non-reproducible, and
// would break the cache and the rule-retry loop. Instead it runs in batch,
// over a contact sheet, and its job is to produce RULES.md candidates: each
// finding must come with a check that could be computed from geometry, so a
// human judgement gets converted once into a deterministic test that then runs
// on every render for free. The agent finds the problem; the rules engine is
// what stops it coming back.
//
//   ANTHROPIC_API_KEY=... node src/design-review.js --type settlement --seeds 12
//
// Requires an API key in the environment. It is never read from a file in the
// repo and never logged.

const fs = require('fs');
const path = require('path');
const { createCanvas } = require('@napi-rs/canvas');
const { renderMap } = require('./render');
const { ENFORCED_RULE_IDS } = require('./rules');

const OUT_DIR = path.resolve(__dirname, '..', 'out');
const MODEL = 'claude-opus-5';

// The reference basis, stated as technique rather than as particular maps.
// The generator must produce original work in this idiom -- the point is to
// describe HOW these maps are drawn, not to reproduce any of them.
const STYLE_BRIEF = `
You are reviewing procedurally generated fantasy map art against three published idioms:

1. WotC / Mike Schley pictorial settlement maps (e.g. the Phandalin style): hand-inked
   pictorial building icons seen at a slight oblique, a single consistent light direction,
   hachure or stipple ground texture that varies in density, serif labels with a pale halo
   and leader lines, and a settlement outline that follows terrain and roads.
2. Inkarnate / Wonderdraft painted cartography: layered washes, soft parchment ground,
   painted forest and mountain masses with internal tonal variation, and coastlines that
   read as drawn rather than computed.
3. Azgaar-style political/region maps: clear landmass silhouette, legible boundaries,
   rivers that flow downhill and merge, and a hierarchy of settlement markers.

Shared conventions across all three that matter most:
- Nothing is radially symmetric. Real places are lopsided.
- Density varies across the map. Uniform anything reads as generated.
- Every element belongs to a structure: buildings line streets, streets connect places,
  settlements sit where terrain allows, rivers run from high ground to the sea.
- The frame is composed: there is foreground subject and surrounding context, not a
  subject floating on blank paper.
`.trim();

function parseArgs(argv) {
  const args = { type: 'settlement', seeds: 12, scale: 1, focus: null, dryRun: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--type') args.type = argv[++i];
    else if (a === '--seeds') args.seeds = parseInt(argv[++i], 10);
    else if (a === '--scale') args.scale = parseFloat(argv[++i]);
    else if (a === '--focus') args.focus = argv[++i];
    // Renders, writes the sheet and prints exactly what would be sent, without
    // calling the API. Costs nothing, needs no key, and makes the request
    // reviewable before spending anything on it.
    else if (a === '--dry-run') args.dryRun = true;
  }
  return args;
}

const TIERS = ['village', 'town', 'city'];

// A grid of renders in one image. The agent is shown the sheet rather than one
// map at a time for the same reason a person needs it: faults like "they are
// all the same shape" are only visible across a population.
function buildSheet(thumbs, cols = 4, cell = 320) {
  const pad = 6, labelH = 16;
  const rows = Math.ceil(thumbs.length / cols);
  const sheet = createCanvas(cols * (cell + pad) + pad, rows * (cell + pad + labelH) + pad);
  const ctx = sheet.getContext('2d');
  ctx.fillStyle = '#1a1a1a';
  ctx.fillRect(0, 0, sheet.width, sheet.height);
  ctx.font = '13px sans-serif';
  ctx.textBaseline = 'top';
  ctx.fillStyle = '#ffffff';
  thumbs.forEach((t, i) => {
    const x = pad + (i % cols) * (cell + pad);
    const y = pad + Math.floor(i / cols) * (cell + pad + labelH);
    ctx.drawImage(t.canvas, x, y, cell, cell);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(t.label, x, y + cell + 2);
  });
  return sheet;
}

const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    overall: {
      type: 'string',
      description: 'Two or three sentences: how close is this population to the idioms, and what is the single biggest gap?',
    },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Short name for the defect.' },
          severity: { type: 'string', enum: ['critical', 'major', 'minor'] },
          category: {
            type: 'string',
            enum: ['silhouette', 'structure', 'density', 'lighting', 'colour', 'labels', 'composition', 'terrain', 'vegetation', 'water'],
          },
          observation: {
            type: 'string',
            description: 'What is actually visible in the images, citing specific panels by their labels.',
          },
          why_it_breaks: {
            type: 'string',
            description: 'Which convention from the style brief this violates, and why it reads as generated.',
          },
          proposed_rule: {
            type: 'string',
            description: 'One sentence, in the imperative, suitable for pasting into RULES.md.',
          },
          proposed_check: {
            type: 'string',
            description: 'How to test it from render-trace geometry or pixels, with a concrete threshold. Must be computable without a model. Say NOT_MECHANISABLE if it genuinely cannot be.',
          },
          severity_reason: { type: 'string' },
        },
        required: ['title', 'severity', 'category', 'observation', 'why_it_breaks', 'proposed_rule', 'proposed_check'],
        additionalProperties: false,
      },
    },
  },
  required: ['overall', 'findings'],
  additionalProperties: false,
};

async function main() {
  const args = parseArgs(process.argv);
  if (!process.env.ANTHROPIC_API_KEY && !args.dryRun) {
    console.error(
      'design-review needs ANTHROPIC_API_KEY in the environment.\n' +
      'It is not read from any file in the repo. Set it for this command only, e.g.\n' +
      '  ANTHROPIC_API_KEY=sk-... node src/design-review.js --type settlement'
    );
    process.exit(2);
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });

  console.log(`rendering ${args.seeds} ${args.type} maps for review...`);
  const thumbs = [];
  for (let i = 0; i < args.seeds; i++) {
    const seed = 1 + i;
    const tier = TIERS[i % TIERS.length];
    const rendered = await renderMap({
      type: args.type, scale: args.scale,
      params: { seed: String(seed), idx: '0', name: `Review${seed}`, tier },
    });
    thumbs.push({ canvas: rendered.canvas, label: `${seed} ${tier}` });
  }

  const sheet = buildSheet(thumbs);
  const sheetPath = path.join(OUT_DIR, `design-review-sheet-${args.type}.png`);
  fs.writeFileSync(sheetPath, sheet.toBuffer('image/png'));
  console.log(`sheet -> ${sheetPath}`);

  // One full-size example too: the sheet shows population-level faults, a
  // single large render shows craft-level ones (linework, shading, label
  // placement) that a 320px thumbnail cannot resolve.
  const detail = thumbs[Math.min(2, thumbs.length - 1)];
  const detailPng = detail.canvas.toBuffer('image/png').toString('base64');

  const promptText =
    `Below is a contact sheet of ${thumbs.length} procedurally generated ${args.type} maps ` +
    `(labelled "<seed> <tier>"), followed by one of them at full size.\n\n` +
    `These rules are ALREADY enforced on every render, so do not report them again ` +
    `unless you can see them actually failing: ${ENFORCED_RULE_IDS.join(', ')}. ` +
    `They cover building-plot overlap, street visibility, ground texture variance, ` +
    `light-direction consistency, street frontage, footprint variety, building counts, ` +
    `and label collision/clipping/duplication.\n\n` +
    `Report what those rules CANNOT see. Prioritise faults visible across the whole ` +
    `population over one-off oddities. For each finding, the proposed check must be ` +
    `computable from geometry or pixels alone -- it is going to become a deterministic ` +
    `test, not a prompt.` +
    (args.focus ? `\n\nPay particular attention to: ${args.focus}` : '');

  if (args.dryRun) {
    console.log('\n--- dry run: nothing sent, nothing charged ---');
    console.log(`model:   ${MODEL}`);
    console.log(`images:  contact sheet ${sheet.width}x${sheet.height}, plus "${detail.label}" at full size`);
    console.log(`\n${STYLE_BRIEF}\n\n${promptText}\n`);
    console.log(`sheet written to ${sheetPath} -- inspect it, then re-run without --dry-run.`);
    return;
  }

  // Required here rather than at the top so --dry-run works in the plain
  // runtime image, which deliberately does not carry the API client.
  const Anthropic = require('@anthropic-ai/sdk');
  const client = new Anthropic();
  console.log(`asking ${MODEL} for a design review...`);

  const message = await client.messages.create({
    model: MODEL,
    max_tokens: 8000,
    thinking: { type: 'adaptive' },
    output_config: { format: { type: 'json_schema', schema: RESPONSE_SCHEMA } },
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: STYLE_BRIEF },
        { type: 'text', text: promptText },
        { type: 'image', source: { type: 'base64', media_type: 'image/png', data: sheet.toBuffer('image/png').toString('base64') } },
        { type: 'text', text: 'And one map at full resolution:' },
        { type: 'image', source: { type: 'base64', media_type: 'image/png', data: detailPng } },
      ],
    }],
  });

  const text = message.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  let report;
  try {
    report = JSON.parse(text);
  } catch {
    console.error('model did not return usable JSON; raw response saved for inspection');
    fs.writeFileSync(path.join(OUT_DIR, `design-review-${args.type}.raw.txt`), text);
    process.exit(1);
  }

  const jsonPath = path.join(OUT_DIR, `design-review-${args.type}.json`);
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));
  fs.writeFileSync(path.join(OUT_DIR, `design-review-${args.type}.md`), toMarkdown(report, args));

  console.log(`\n${report.overall}\n`);
  const order = { critical: 0, major: 1, minor: 2 };
  const sorted = [...report.findings].sort((a, b) => order[a.severity] - order[b.severity]);
  for (const f of sorted) {
    const mech = /^NOT_MECHANISABLE/.test(f.proposed_check) ? '  [needs a human]' : '';
    console.log(`  [${f.severity}] ${f.category}: ${f.title}${mech}`);
    console.log(`      rule:  ${f.proposed_rule}`);
    console.log(`      check: ${f.proposed_check}`);
  }
  console.log(`\nreport -> ${jsonPath}`);
  console.log(`usage: ${message.usage.input_tokens} in / ${message.usage.output_tokens} out`);
}

function toMarkdown(report, args) {
  const order = { critical: 0, major: 1, minor: 2 };
  const lines = [
    `# Design review — ${args.type}`,
    '',
    `${args.seeds} seeds, model ${MODEL}, ${new Date().toISOString().slice(0, 10)}.`,
    '',
    report.overall,
    '',
    '## Findings',
    '',
  ];
  for (const f of [...report.findings].sort((a, b) => order[a.severity] - order[b.severity])) {
    lines.push(
      `### ${f.title} — ${f.severity} (${f.category})`, '',
      `**Seen:** ${f.observation}`, '',
      `**Why it matters:** ${f.why_it_breaks}`, '',
      `**Proposed rule:** ${f.proposed_rule}`, '',
      `**Proposed check:** \`${f.proposed_check}\``, '',
    );
  }
  return lines.join('\n');
}

main().catch((err) => {
  console.error('DESIGN REVIEW FAILED:', err.message);
  process.exit(2);
});
