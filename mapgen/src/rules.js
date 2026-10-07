// The machine half of RULES.md. Every rule ID here maps to a rule in that
// document; change the document first, then this.
//
// Two kinds of evidence:
//   geometry -- the render trace (lib/render-trace.js): exact polygons for
//               buildings, roads, labels. Answers overlap/occlusion/collision.
//   pixels   -- the rendered bitmap. Answers coverage, variance, contrast.
// Checks that could be done either way use geometry, because it says what
// was drawn rather than what the result happens to look like.

// --- geometry helpers -------------------------------------------------

function polyBounds(poly) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of poly) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}

function boundsOverlap(a, b) {
  return !(a.maxX <= b.minX || b.maxX <= a.minX || a.maxY <= b.minY || b.maxY <= a.minY);
}

// Separating Axis Theorem for two convex polygons. Building plots are
// rotated rectangles, so SAT is exact here -- an area-overlap estimate would
// blur exactly the near-miss cases that matter.
function convexPolysIntersect(a, b, tolerance = 0) {
  for (const poly of [a, b]) {
    for (let i = 0; i < poly.length; i++) {
      const p1 = poly[i], p2 = poly[(i + 1) % poly.length];
      let axX = -(p2.y - p1.y), axY = p2.x - p1.x;
      const len = Math.hypot(axX, axY) || 1;
      axX /= len; axY /= len;
      let aMin = Infinity, aMax = -Infinity, bMin = Infinity, bMax = -Infinity;
      for (const p of a) { const d = p.x * axX + p.y * axY; if (d < aMin) aMin = d; if (d > aMax) aMax = d; }
      for (const p of b) { const d = p.x * axX + p.y * axY; if (d < bMin) bMin = d; if (d > bMax) bMax = d; }
      if (aMax - tolerance <= bMin || bMax - tolerance <= aMin) return false; // separating axis found
    }
  }
  return true;
}

function pointSegmentDistance(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1;
  const lenSq = dx * dx + dy * dy || 1;
  let t = ((px - x1) * dx + (py - y1) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x1 + dx * t), py - (y1 + dy * t));
}

function pointInPoly(px, py, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y, xj = poly[j].x, yj = poly[j].y;
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi + 1e-12) + xi) inside = !inside;
  }
  return inside;
}

function rectsIntersect(a, b) {
  return !(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y);
}

function luminance(r, g, b) {
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

// --- individual rules -------------------------------------------------

// B1: a building never leaves its plot, and plots never overlap.
function checkB1(trace) {
  const b = trace.buildings || [];
  const bounds = b.map((x) => polyBounds(x.plot));
  const collisions = [];
  for (let i = 0; i < b.length; i++) {
    // The silhouette (roof + gable tips) must stay inside the allotted plot.
    for (const pt of b[i].silhouette || []) {
      if (!pointInPoly(pt.x, pt.y, b[i].plot)) {
        collisions.push({ kind: 'silhouette_outside_plot', i });
        break;
      }
    }
    for (let j = i + 1; j < b.length; j++) {
      if (!boundsOverlap(bounds[i], bounds[j])) continue; // cheap reject first
      if (convexPolysIntersect(b[i].plot, b[j].plot, 0.5)) collisions.push({ kind: 'plot_overlap', i, j });
    }
  }
  return {
    id: 'B1', severity: 'hard', pass: collisions.length === 0,
    detail: collisions.length ? `${collisions.length} collision(s), e.g. ${JSON.stringify(collisions[0])}` : `${b.length} buildings, none overlapping`,
    value: collisions.length,
  };
}

// S1: streets stay legible -- buildings must not bury the road network.
// Sampled along each centreline rather than by area, because what matters is
// whether a continuous run of the street stays visible.
function checkS1(trace, opts = {}) {
  const minVisible = opts.minVisible !== undefined ? opts.minVisible : 0.7;
  const roads = trace.roads || [];
  const buildings = trace.buildings || [];
  if (!roads.length) {
    return { id: 'S1', severity: 'hard', pass: false, detail: 'no roads drawn at all', value: 0 };
  }
  let total = 0, covered = 0;
  for (const road of roads) {
    for (let i = 0; i < road.points.length - 1; i++) {
      const a = road.points[i], b = road.points[i + 1];
      const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 3));
      for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        const px = a.x + (b.x - a.x) * t, py = a.y + (b.y - a.y) * t;
        total++;
        for (const bld of buildings) {
          if (pointInPoly(px, py, bld.plot)) { covered++; break; }
        }
      }
    }
  }
  const visible = total ? 1 - covered / total : 0;
  return {
    id: 'S1', severity: 'hard', pass: visible >= minVisible,
    detail: `${(visible * 100).toFixed(1)}% of street length visible (need ${(minVisible * 100).toFixed(0)}%)`,
    value: +visible.toFixed(4),
  };
}

// B4: buildings line the streets instead of being sprinkled across open
// ground. Written into RULES.md from the start but never actually measured,
// which is why a contact sheet of 24 maps showed buildings scattered like
// confetti while the audit reported everything passing -- a check that does
// not exist cannot fail, and an unimplemented rule is worse than an absent
// one because it reads as coverage.
//
// Measured as the share of buildings whose centre is within a short walk of a
// road centreline, scaled to the building's own size so it means the same
// thing for a cottage and a cathedral.
function checkB4(trace, opts = {}) {
  const minFrac = opts.minOnStreet !== undefined ? opts.minOnStreet : 0.75;
  const roads = trace.roads || [];
  const buildings = trace.buildings || [];
  if (!roads.length || buildings.length < 4) return null;

  let onStreet = 0;
  for (const b of buildings) {
    // A building "fronts" a street if the gap between them is under about
    // half its own frontage -- roughly a plot's depth, the distance at which
    // a building reads as belonging to the road rather than sitting behind it.
    const reach = Math.max(b.w, b.h) * 0.75 + 6;
    let near = false;
    for (const road of roads) {
      for (let i = 0; i < road.points.length - 1 && !near; i++) {
        if (pointSegmentDistance(b.cx, b.cy, road.points[i], road.points[i + 1]) <= reach) near = true;
      }
      if (near) break;
    }
    if (near) onStreet++;
  }
  const frac = onStreet / buildings.length;
  return {
    id: 'B4', severity: 'soft', pass: frac >= minFrac,
    detail: `${onStreet}/${buildings.length} buildings front a street (${(frac * 100).toFixed(0)}%, need ${(minFrac * 100).toFixed(0)}%)`,
    value: +frac.toFixed(3),
  };
}

function pointSegmentDistance(px, py, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(px - a.x, py - a.y);
  let t = ((px - a.x) * dx + (py - a.y) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (a.x + t * dx), py - (a.y + t * dy));
}

// L2 / L3: labels neither collide with each other nor leave the canvas.
function checkLabels(trace, canvasW, canvasH) {
  const labels = trace.labels || [];
  const collisions = [];
  for (let i = 0; i < labels.length; i++) {
    for (let j = i + 1; j < labels.length; j++) {
      if (rectsIntersect(labels[i].box, labels[j].box)) collisions.push([labels[i].text, labels[j].text]);
    }
  }
  const clipped = labels.filter((l) => l.box.x < 4 || l.box.y < 4 || l.box.x + l.box.w > canvasW - 4 || l.box.y + l.box.h > canvasH - 4);

  // L5: two labels reading the same text make both useless as names. This
  // existed for as long as cities had two gate guard posts, and was only
  // noticed because an L2 collision happened to print both texts side by
  // side -- a rule of its own so it can't hide behind another one again.
  const seen = new Set(), dupes = new Set();
  for (const l of labels) {
    if (seen.has(l.text)) dupes.add(l.text);
    seen.add(l.text);
  }

  return [
    {
      id: 'L2', severity: 'hard', pass: collisions.length === 0,
      detail: collisions.length ? `${collisions.length} overlapping pair(s), e.g. ${collisions[0].join(' / ')}` : `${labels.length} labels, none overlapping`,
      value: collisions.length,
    },
    {
      id: 'L3', severity: 'hard', pass: clipped.length === 0,
      detail: clipped.length ? `${clipped.length} clipped by canvas edge: ${clipped.map((l) => l.text).join(', ')}` : 'all labels within bounds',
      value: clipped.length,
    },
    {
      id: 'L5', severity: 'hard', pass: dupes.size === 0,
      detail: dupes.size ? `duplicate label text: ${[...dupes].join(', ')}` : `${labels.length} labels, all distinct`,
      value: dupes.size,
    },
  ];
}

// G1 / G2: the ground is drawn, and its texture varies rather than reading
// as one flat mat. Both measured on the bitmap over the settlement's own
// area, using local contrast as a proxy for ink coverage -- hachure is thin
// dark strokes over a flat ground, so per-tile variation of pixel luminance
// tracks how much texture is present.
function checkGround(pixels, canvasW, canvasH, opts = {}) {
  const tile = opts.tile || 24;
  const tiles = [];
  for (let ty = 0; ty + tile <= canvasH; ty += tile) {
    for (let tx = 0; tx + tile <= canvasW; tx += tile) {
      let sum = 0, sumSq = 0, n = 0;
      for (let y = ty; y < ty + tile; y += 2) {
        for (let x = tx; x < tx + tile; x += 2) {
          const idx = (y * canvasW + x) * 4;
          const l = luminance(pixels[idx], pixels[idx + 1], pixels[idx + 2]);
          sum += l; sumSq += l * l; n++;
        }
      }
      const mean = sum / n;
      tiles.push(Math.sqrt(Math.max(0, sumSq / n - mean * mean))); // per-tile stddev = "how textured"
    }
  }
  if (!tiles.length) return [];
  const mean = tiles.reduce((a, b) => a + b, 0) / tiles.length;
  const variance = Math.sqrt(tiles.reduce((a, b) => a + (b - mean) * (b - mean), 0) / tiles.length);
  const quietFraction = tiles.filter((t) => t < mean * 0.5).length / tiles.length;
  const minTexture = opts.minTexture !== undefined ? opts.minTexture : 0.012;
  const minVariance = opts.minVariance !== undefined ? opts.minVariance : 0.012;
  const minQuiet = opts.minQuiet !== undefined ? opts.minQuiet : 0.08;
  return [
    {
      id: 'G1', severity: 'hard', pass: mean >= minTexture,
      detail: `mean tile texture ${mean.toFixed(4)} (need >= ${minTexture})`,
      value: +mean.toFixed(4),
    },
    {
      id: 'G2', severity: 'hard', pass: variance >= minVariance && quietFraction >= minQuiet,
      detail: `texture variance ${variance.toFixed(4)} (need >= ${minVariance}), open ground ${(quietFraction * 100).toFixed(1)}% (need >= ${(minQuiet * 100).toFixed(0)}%)`,
      value: +variance.toFixed(4),
    },
  ];
}

// C3: the settlement sits in visible countryside rather than on blank paper.
//
// Measured on tiles that fall wholly OUTSIDE the town's own boundary, using
// the same per-tile luminance spread that G1/G2 use inside it -- a tile with
// something drawn on it (a field, a stand of trees, a road running out of
// frame) has local contrast; bare parchment does not. Tiles that are mostly
// off-canvas or inside the town are skipped so the figure means "how much of
// the countryside is drawn", not "how big is the town".
function checkC3(trace, pixels, canvasW, canvasH, opts = {}) {
  const boundary = (trace.boundary && trace.boundary[0] && trace.boundary[0].loop) || null;
  if (!boundary || !pixels) return null;
  const minCovered = opts.minSurroundings !== undefined ? opts.minSurroundings : 0.15;
  const tile = opts.tile || 24;

  let outside = 0, drawn = 0;
  for (let ty = 0; ty + tile <= canvasH; ty += tile) {
    for (let tx = 0; tx + tile <= canvasW; tx += tile) {
      if (pointInPoly(tx + tile / 2, ty + tile / 2, boundary)) continue;
      outside++;
      let sum = 0, sumSq = 0, n = 0;
      for (let y = ty; y < ty + tile; y += 2) {
        for (let x = tx; x < tx + tile; x += 2) {
          const idx = (y * canvasW + x) * 4;
          const l = luminance(pixels[idx], pixels[idx + 1], pixels[idx + 2]);
          sum += l; sumSq += l * l; n++;
        }
      }
      const mean = sum / n;
      if (Math.sqrt(Math.max(0, sumSq / n - mean * mean)) >= 0.012) drawn++;
    }
  }
  if (!outside) return null;
  const frac = drawn / outside;
  return {
    id: 'C3', severity: 'soft', pass: frac >= minCovered,
    detail: `${(frac * 100).toFixed(1)}% of the surrounding country carries detail (need >= ${(minCovered * 100).toFixed(0)}%)`,
    value: +frac.toFixed(3),
  };
}

// C2: the settlement is of a believable size for its tier.
const TIER_BUILDING_BANDS = { village: [6, 20], town: [25, 70], city: [60, 160] };
function checkC2(trace, tier) {
  const band = TIER_BUILDING_BANDS[tier];
  if (!band) return null;
  const n = (trace.buildings || []).length;
  return {
    id: 'C2', severity: 'soft', pass: n >= band[0] && n <= band[1],
    detail: `${n} buildings for a ${tier} (expected ${band[0]}-${band[1]})`,
    value: n,
  };
}

// B3: one light direction across the whole map. Measured on the world-space
// normal of whichever roof plane was actually lit, which is what the eye
// reads -- inferring it from the building's rotation instead cannot
// distinguish "lit consistently" from "rotated consistently".
//
// The metric is the fraction of roofs whose lit slope FACES the light, not
// the agreement between the slopes' directions. The first version measured
// the latter (mean resultant length of the normals) and was unsatisfiable by
// construction: a gable's lit plane is perpendicular to its ridge, and the
// ridge turns with the building to face its street, so the normals
// necessarily fan out. Once every roof faces the light the normals fill a
// half-plane, whose mean resultant length maxes out at 2/pi ~ 0.64 -- which
// is precisely the 63-66% the audit reported for a scene that was in fact
// lit correctly. Reference maps behave the same way: roofs at all angles,
// each with its sunward slope pale, none of them parallel.
function checkB3(trace) {
  const normals = (trace.buildings || []).map((b) => b.litNormal).filter(Boolean);
  if (normals.length < 2) return null;
  const LIGHT = { x: -0.7071, y: -0.7071 };   // must match MAP_LIGHT_DIR
  // A ridge running along the light leaves both planes equally lit, so the
  // choice there is arbitrary and shouldn't be scored either way.
  const AMBIGUOUS = 0.08;
  let facing = 0, judged = 0;
  for (const n of normals) {
    const d = n.x * LIGHT.x + n.y * LIGHT.y;
    if (Math.abs(d) < AMBIGUOUS) continue;
    judged++;
    if (d > 0) facing++;
  }
  if (judged < 2) return null;
  const frac = facing / judged;
  return {
    id: 'B3', severity: 'soft', pass: frac >= 0.98,
    detail: `${facing}/${judged} roofs lit from the map light direction (${(frac * 100).toFixed(0)}%)`,
    value: +frac.toFixed(3),
  };
}

// B5: footprints vary in size rather than being one repeated stamp.
function checkB5(trace) {
  const areas = (trace.buildings || []).map((b) => b.w * b.h).filter((a) => a > 0);
  if (areas.length < 4) return null;
  const mean = areas.reduce((a, b) => a + b, 0) / areas.length;
  const sd = Math.sqrt(areas.reduce((a, b) => a + (b - mean) * (b - mean), 0) / areas.length);
  const cv = mean ? sd / mean : 0;
  return {
    id: 'B5', severity: 'soft', pass: cv >= 0.25,
    detail: `building-area coefficient of variation ${cv.toFixed(3)} (need >= 0.25)`,
    value: +cv.toFixed(3),
  };
}

// Runs every rule applicable to a settlement render.
function evaluateSettlement({ trace, pixels, width, height, tier, thresholds = {} }) {
  const results = [];
  results.push(checkB1(trace));
  results.push(checkS1(trace, thresholds));
  results.push(...checkLabels(trace, width, height));
  if (pixels) results.push(...checkGround(pixels, width, height, thresholds));
  for (const r of [
    checkC2(trace, tier), checkC3(trace, pixels, width, height, thresholds),
    checkB3(trace), checkB4(trace, thresholds), checkB5(trace),
  ]) if (r) results.push(r);
  const hardFailures = results.filter((r) => r.severity === 'hard' && !r.pass);
  return { results, hardFailures, ok: hardFailures.length === 0 };
}

// The rules that actually run. Kept next to the implementation so it cannot
// drift from it, and handed to the design agent so it spends its attention on
// what nothing else is watching rather than re-reporting these.
const ENFORCED_RULE_IDS = ['G1', 'G2', 'B1', 'B3', 'B4', 'B5', 'S1', 'L2', 'L3', 'L5', 'C2', 'C3'];

module.exports = {
  evaluateSettlement, ENFORCED_RULE_IDS,
  checkB1, checkS1, checkLabels, checkGround, checkC2, checkC3, checkB3, checkB4, checkB5,
  convexPolysIntersect, pointInPoly, polyBounds,
};
