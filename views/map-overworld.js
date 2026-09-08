// forestBias/ruggedBias let the live Vegetation/Ruggedness sliders (Phase 9)
// shift the moisture and height thresholds without touching the height or
// moisture fields themselves -- the terrain's actual shape never changes,
// only where the biome lines fall on it. Thresholds are floored relative to
// each other (and to seaLevel) rather than shifted freely, so a slider
// dragged to its extreme can never invert or collapse the ordering into a
// degenerate all-one-biome map.
function biomeAt(h, moist, seaLevel, forestBias, ruggedBias) {
  forestBias = forestBias || 0;
  ruggedBias = ruggedBias || 0;
  if (h < seaLevel - 0.08) return 'deepwater';
  if (h < seaLevel) return 'shallowwater';
  if (h < seaLevel + 0.03) return 'beach';
  const hillsT = Math.max(seaLevel + 0.08, 0.55 - ruggedBias);
  const mountainsT = Math.max(hillsT + 0.05, 0.7 - ruggedBias);
  const snowT = Math.max(mountainsT + 0.05, 0.85 - ruggedBias);
  if (h > snowT) return 'snow';
  if (h > mountainsT) return 'mountains';
  if (h > hillsT) return 'hills';
  const forestT = Math.min(0.9, Math.max(0.1, 0.5 - forestBias));
  // Barrens mirrors forestT's own pattern at the opposite end of the
  // moisture range (floored strictly below forestT so forestBias can never
  // push the two thresholds past each other into a degenerate ordering) --
  // an arid lowland base biome, previously missing entirely (moisture below
  // forestT always fell through to plains regardless of how dry). Needed as
  // the base for the Bloodstone Desert / Salt Flats special-zone reflavors,
  // which recolor barrens cells rather than inventing their own band.
  const aridT = Math.max(0, Math.min(forestT - 0.15, 0.22 - forestBias * 0.5));
  if (moist > forestT) return 'forest';
  if (moist < aridT) return 'barrens';
  return 'plains';
}

// Per-biome decorative texture drawn on top of the flat fill, using a
// dedicated rng consumed strictly in raster (row-major) order -- so it's
// fully deterministic per seed independent of settlement/road generation,
// which happens afterward against the (already-final) biome grid. Gated by
// probability per biome so it reads as texture/iconography, not a solid
// carpet of icons.
function paintBiomeTexture(ctx, biome, cx, cy, cw, ch, rng, ink) {
  const r = rng();
  switch (biome) {
    case 'forest': {
      // Dense enough to read as a forest carpet (WotC-style regional maps
      // never show bare ground under a forest biome) -- up to two trees per
      // cell, each a two-tier conifer silhouette rather than one flat
      // triangle, so the texture itself carries more art-quality detail.
      if (r > 0.85) return;
      const treeCount = 1 + Math.floor(rng() * 2);
      for (let t = 0; t < treeCount; t++) {
        const tx = cx + (rng() - 0.5) * cw * 0.6;
        const ty = cy + (rng() - 0.5) * ch * 0.4;
        const size = Math.min(cw, ch) * (0.22 + rng() * 0.14);
        ctx.fillStyle = ink;
        ctx.globalAlpha = 0.6;
        ctx.beginPath();
        ctx.moveTo(tx, ty - size);
        ctx.lineTo(tx - size * 0.55, ty - size * 0.15);
        ctx.lineTo(tx + size * 0.55, ty - size * 0.15);
        ctx.closePath();
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(tx, ty - size * 0.5);
        ctx.lineTo(tx - size * 0.7, ty + size * 0.45);
        ctx.lineTo(tx + size * 0.7, ty + size * 0.45);
        ctx.closePath();
        ctx.fill();
        ctx.fillRect(tx - size * 0.07, ty + size * 0.35, size * 0.14, size * 0.3);
      }
      ctx.globalAlpha = 1;
      break;
    }
    // 'mountains' and 'hills' texture is now paintRosetteTexture(), called
    // separately after the watercolor-wash pass so it sits on top of the
    // painted region rather than the old flat per-cell fill.
    case 'plains': {
      if (r > 0.3) return;
      ctx.strokeStyle = ink;
      ctx.globalAlpha = 0.4;
      ctx.lineWidth = 1;
      const lean = (rng() - 0.5) * cw * 0.3;
      ctx.beginPath();
      ctx.moveTo(cx - cw * 0.15, cy + ch * 0.3);
      ctx.lineTo(cx - cw * 0.15 + lean, cy - ch * 0.3);
      ctx.stroke();
      ctx.globalAlpha = 1;
      break;
    }
    case 'deepwater':
    case 'shallowwater': {
      if (r > 0.3) return;
      ctx.strokeStyle = ink;
      ctx.globalAlpha = 0.35;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(cx - cw * 0.4, cy);
      ctx.quadraticCurveTo(cx, cy - ch * 0.35, cx + cw * 0.4, cy);
      ctx.stroke();
      ctx.globalAlpha = 1;
      break;
    }
    case 'beach': {
      if (r > 0.35) return;
      ctx.fillStyle = ink;
      ctx.globalAlpha = 0.4;
      ctx.beginPath();
      ctx.arc(cx, cy, Math.max(0.6, cw * 0.08), 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      break;
    }
    case 'snow': {
      if (r > 0.2) return;
      ctx.strokeStyle = ink;
      ctx.globalAlpha = 0.5;
      ctx.lineWidth = 1;
      const s = cw * 0.14;
      ctx.beginPath();
      ctx.moveTo(cx - s, cy); ctx.lineTo(cx + s, cy);
      ctx.moveTo(cx, cy - s); ctx.lineTo(cx, cy + s);
      ctx.stroke();
      ctx.globalAlpha = 1;
      break;
    }
    case 'barrens': {
      // A lone scrub/cracked-ground mark -- sparser than plains' grass tick,
      // reading as "nothing much grows here" rather than a distinct plant.
      if (r > 0.25) return;
      ctx.strokeStyle = ink;
      ctx.globalAlpha = 0.35;
      ctx.lineWidth = 1;
      const s = cw * 0.1;
      ctx.beginPath();
      ctx.moveTo(cx - s, cy + s * 0.6); ctx.lineTo(cx + s, cy - s * 0.6);
      ctx.moveTo(cx - s * 0.3, cy - s); ctx.lineTo(cx + s * 0.5, cy + s * 0.8);
      ctx.stroke();
      ctx.globalAlpha = 1;
      break;
    }
  }
}

// Sunburst-rosette hill/mountain hatching (Silver Marches/Vaasa style, per
// the map-generator plan's reference research) -- a small ring plus 8
// short radiating strokes, scattered a couple per cell as fine hatching on
// top of the watercolor wash, not a solid fill. Replaces paintBiomeTexture's
// old arc-bump ('hills') and jagged-peak ('mountains') cases; `bold` draws
// one more rosette for mountains than hills, so the two stay distinguishable
// even though both share one combined watercolor-wash base tone (see
// paintWatercolorWash call sites below). Went through three tunings before
// landing here, each only checked at an artificial zoom and missing how it
// actually reads at a real map's cell density: too small/faint was
// invisible; the fix for that then drew 2-5 large, opaque rosettes on every
// matching cell, which at a dense hill/mountain mass compounds into a
// solid, illegible scribble covering the whole region. This tuning keeps
// each rosette small (so many overlapping ones still read as texture, not
// blobs) at a modest, fixed per-cell count (so coverage is dense enough to
// actually register without needing an artificial zoom, but never solid).
function paintRosetteTexture(ctx, cx, cy, cw, ch, rng, ink, bold) {
  const count = bold ? 3 : 2;
  for (let i = 0; i < count; i++) {
    const rx = cx + (rng() - 0.5) * cw * 0.65;
    const ry = cy + (rng() - 0.5) * ch * 0.65;
    const r = Math.min(cw, ch) * (0.06 + rng() * 0.04);
    ctx.strokeStyle = ink;
    ctx.globalAlpha = 0.5;
    ctx.lineWidth = Math.max(0.7, r * 0.18);
    ctx.beginPath();
    ctx.arc(rx, ry, r, 0, Math.PI * 2);
    ctx.stroke();
    for (let k = 0; k < 8; k++) {
      const angle = (Math.PI / 4) * k;
      ctx.beginPath();
      ctx.moveTo(rx + Math.cos(angle) * r * 1.15, ry + Math.sin(angle) * r * 1.15);
      ctx.lineTo(rx + Math.cos(angle) * r * 1.55, ry + Math.sin(angle) * r * 1.55);
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;
}

// Wild-zone icon glyphs -- one dispatcher covering every iconKey referenced
// by lib/map-biome-zones.js's three tables (special zones, range zones,
// point landmarks) plus the Scrying Pool decoration, all drawn with the
// same plain-canvas-path convention as every other icon function in this
// file (drawSettlementIcon, paintRosetteTexture, drawCornerMedallion): no
// image assets, lineWidth 0.8-1.5, alpha 0.6-0.9 for texture softness.
function drawWildZoneIcon(ctx, x, y, key, ink) {
  ctx.save();
  ctx.strokeStyle = ink;
  ctx.fillStyle = ink;
  ctx.lineWidth = 1;
  ctx.globalAlpha = 0.75;
  const s = 6;
  switch (key) {
    case 'ashTree': // a bare, leafless tree -- forest's silhouette with the canopy stripped out
      ctx.beginPath();
      ctx.moveTo(x, y + s); ctx.lineTo(x, y - s * 0.3);
      ctx.moveTo(x, y - s * 0.1); ctx.lineTo(x - s * 0.6, y - s);
      ctx.moveTo(x, y - s * 0.3); ctx.lineTo(x + s * 0.55, y - s * 0.9);
      ctx.moveTo(x, y - s * 0.5); ctx.lineTo(x - s * 0.4, y - s * 0.95);
      ctx.stroke();
      break;
    case 'petrifiedSpire': // a jagged stone spike, hills' rosette gone rigid
      ctx.beginPath();
      ctx.moveTo(x - s * 0.4, y + s * 0.5);
      ctx.lineTo(x - s * 0.15, y - s);
      ctx.lineTo(x + s * 0.1, y - s * 0.2);
      ctx.lineTo(x + s * 0.4, y + s * 0.5);
      ctx.closePath();
      ctx.stroke();
      break;
    case 'bramble': // a tangled thorny scribble
      ctx.beginPath();
      ctx.moveTo(x - s, y); ctx.lineTo(x + s, y);
      ctx.moveTo(x - s * 0.6, y - s * 0.5); ctx.lineTo(x + s * 0.6, y + s * 0.5);
      ctx.moveTo(x - s * 0.6, y + s * 0.5); ctx.lineTo(x + s * 0.6, y - s * 0.5);
      ctx.stroke();
      break;
    case 'mushroomCap': // a mushroom silhouette, cap + stem
      ctx.beginPath();
      ctx.arc(x, y - s * 0.1, s * 0.55, Math.PI, 0);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(x - s * 0.18, y - s * 0.1); ctx.lineTo(x - s * 0.14, y + s * 0.5);
      ctx.lineTo(x + s * 0.14, y + s * 0.5); ctx.lineTo(x + s * 0.18, y - s * 0.1);
      ctx.stroke();
      break;
    case 'boneStake': // crossed bones
      ctx.beginPath();
      ctx.moveTo(x - s * 0.6, y - s * 0.5); ctx.lineTo(x + s * 0.6, y + s * 0.5);
      ctx.moveTo(x - s * 0.6, y + s * 0.5); ctx.lineTo(x + s * 0.6, y - s * 0.5);
      ctx.stroke();
      ctx.globalAlpha = 0.9;
      [[-0.6, -0.5], [0.6, 0.5], [-0.6, 0.5], [0.6, -0.5]].forEach(([dx, dy]) => {
        ctx.beginPath();
        ctx.arc(x + dx * s, y + dy * s, s * 0.14, 0, Math.PI * 2);
        ctx.fill();
      });
      break;
    case 'wisp': // a will-o-wisp: a glowing dot with faint radiating rays
      ctx.beginPath();
      ctx.arc(x, y, s * 0.22, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 0.4;
      for (let k = 0; k < 6; k++) {
        const angle = (Math.PI / 3) * k;
        ctx.beginPath();
        ctx.moveTo(x + Math.cos(angle) * s * 0.35, y + Math.sin(angle) * s * 0.35);
        ctx.lineTo(x + Math.cos(angle) * s * 0.9, y + Math.sin(angle) * s * 0.9);
        ctx.stroke();
      }
      break;
    case 'redRock': // a jagged, angular boulder
      ctx.beginPath();
      ctx.moveTo(x - s * 0.6, y + s * 0.4);
      ctx.lineTo(x - s * 0.3, y - s * 0.5);
      ctx.lineTo(x + s * 0.15, y - s * 0.15);
      ctx.lineTo(x + s * 0.6, y + s * 0.4);
      ctx.closePath();
      ctx.stroke();
      break;
    case 'saltCrust': // hatched cracked-crust marks
      ctx.beginPath();
      ctx.moveTo(x - s * 0.6, y - s * 0.3); ctx.lineTo(x + s * 0.2, y + s * 0.5);
      ctx.moveTo(x - s * 0.1, y - s * 0.6); ctx.lineTo(x + s * 0.6, y + s * 0.1);
      ctx.stroke();
      break;
    case 'corruptionTendril': // a spiky, reaching crack
      ctx.beginPath();
      ctx.moveTo(x, y + s); ctx.lineTo(x - s * 0.2, y);
      ctx.lineTo(x + s * 0.3, y - s * 0.3); ctx.lineTo(x - s * 0.1, y - s);
      ctx.stroke();
      break;
    case 'volcanicVent': // a triangle vent with ember dots
      ctx.beginPath();
      ctx.moveTo(x - s * 0.5, y + s * 0.5); ctx.lineTo(x, y - s * 0.6); ctx.lineTo(x + s * 0.5, y + s * 0.5);
      ctx.closePath();
      ctx.stroke();
      ctx.globalAlpha = 0.9;
      ctx.beginPath(); ctx.arc(x - s * 0.1, y - s * 0.9, s * 0.1, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(x + s * 0.2, y - s * 1.15, s * 0.08, 0, Math.PI * 2); ctx.fill();
      break;
    case 'crystalShard': // a faceted diamond cluster
      ctx.beginPath();
      ctx.moveTo(x, y - s); ctx.lineTo(x + s * 0.4, y); ctx.lineTo(x, y + s * 0.7); ctx.lineTo(x - s * 0.4, y);
      ctx.closePath();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x + s * 0.4, y - s * 0.3); ctx.lineTo(x + s * 0.75, y + s * 0.1); ctx.lineTo(x + s * 0.4, y + s * 0.45);
      ctx.stroke();
      break;
    case 'stormBolt': // a lightning zigzag
      ctx.beginPath();
      ctx.moveTo(x - s * 0.2, y - s); ctx.lineTo(x + s * 0.2, y - s * 0.15);
      ctx.lineTo(x - s * 0.1, y - s * 0.15); ctx.lineTo(x + s * 0.2, y + s);
      ctx.stroke();
      break;
    case 'obsidianShard': // a dark angular shard
      ctx.beginPath();
      ctx.moveTo(x - s * 0.35, y + s * 0.6); ctx.lineTo(x - s * 0.1, y - s * 0.7); ctx.lineTo(x + s * 0.4, y + s * 0.2);
      ctx.closePath();
      ctx.fill();
      break;
    case 'cloudWisp': // a small cloud swirl, drawn above a peak
      ctx.beginPath();
      ctx.arc(x - s * 0.3, y, s * 0.28, 0, Math.PI * 2);
      ctx.arc(x + s * 0.1, y - s * 0.12, s * 0.34, 0, Math.PI * 2);
      ctx.arc(x + s * 0.5, y, s * 0.24, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'leyLineNexus': // a rune circle with a crossing line
      ctx.beginPath();
      ctx.arc(x, y, s * 0.6, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x - s * 0.6, y - s * 0.4); ctx.lineTo(x + s * 0.6, y + s * 0.4);
      ctx.stroke();
      break;
    case 'astralScar': // a tear/rift: two arcs pulled apart
      ctx.beginPath();
      ctx.moveTo(x - s * 0.5, y - s * 0.7);
      ctx.quadraticCurveTo(x - s * 0.15, y, x - s * 0.5, y + s * 0.7);
      ctx.moveTo(x + s * 0.5, y - s * 0.7);
      ctx.quadraticCurveTo(x + s * 0.15, y, x + s * 0.5, y + s * 0.7);
      ctx.stroke();
      break;
    case 'giantsGarden': // an oversized leaf over a broken column stub
      ctx.beginPath();
      ctx.moveTo(x, y + s * 0.6); ctx.lineTo(x, y - s * 0.1);
      ctx.lineTo(x - s * 0.35, y - s * 0.1); ctx.lineTo(x, y - s * 0.9); ctx.lineTo(x + s * 0.35, y - s * 0.1);
      ctx.closePath();
      ctx.fill();
      break;
    case 'sunkenRuins': // ruin blocks half-submerged, wavy waterline
      ctx.beginPath();
      ctx.moveTo(x - s * 0.5, y); ctx.lineTo(x - s * 0.5, y - s * 0.7); ctx.lineTo(x - s * 0.1, y - s * 0.7); ctx.lineTo(x - s * 0.1, y);
      ctx.moveTo(x + s * 0.1, y); ctx.lineTo(x + s * 0.1, y - s * 0.45); ctx.lineTo(x + s * 0.5, y - s * 0.45); ctx.lineTo(x + s * 0.5, y);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x - s * 0.7, y); ctx.quadraticCurveTo(x - s * 0.35, y + s * 0.2, x, y);
      ctx.quadraticCurveTo(x + s * 0.35, y + s * 0.2, x + s * 0.7, y);
      ctx.stroke();
      break;
    case 'scryingPool': // a rippling eye over water -- a lidded almond with a ring iris
      ctx.beginPath();
      ctx.moveTo(x - s * 0.7, y); ctx.quadraticCurveTo(x, y - s * 0.55, x + s * 0.7, y);
      ctx.quadraticCurveTo(x, y + s * 0.55, x - s * 0.7, y);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(x, y, s * 0.22, 0, Math.PI * 2);
      ctx.stroke();
      break;
  }
  ctx.globalAlpha = 1;
  ctx.restore();
}

// Relative cost of routing a road through each biome -- plains/beach are
// cheap, forest and hills cost more, mountains and snow cost the most.
// Water isn't listed because computeRoadPath excludes water cells from the
// routable graph entirely (roads in this world don't cross open water).
const OW_TERRAIN_ROAD_COST = { beach: 1.2, plains: 1, forest: 1.3, hills: 2, mountains: 4, snow: 2.5, barrens: 1.5 };

// Binary min-heap keyed by `.dist`, used only by computeRoadPath below.
function MinHeap() { this.a = []; }
MinHeap.prototype.push = function (item) {
  const a = this.a;
  a.push(item);
  let i = a.length - 1;
  while (i > 0) {
    const parent = (i - 1) >> 1;
    if (a[parent].dist <= a[i].dist) break;
    const tmp = a[parent]; a[parent] = a[i]; a[i] = tmp;
    i = parent;
  }
};
MinHeap.prototype.pop = function () {
  const a = this.a;
  const top = a[0];
  const last = a.pop();
  if (a.length > 0) {
    a[0] = last;
    let i = 0;
    for (;;) {
      const l = i * 2 + 1, r = i * 2 + 2;
      let smallest = i;
      if (l < a.length && a[l].dist < a[smallest].dist) smallest = l;
      if (r < a.length && a[r].dist < a[smallest].dist) smallest = r;
      if (smallest === i) break;
      const tmp = a[smallest]; a[smallest] = a[i]; a[i] = tmp;
      i = smallest;
    }
  }
  return top;
};

// Dijkstra shortest path over the mesh's cell-adjacency graph, weighted by
// terrain -- replaces a straight jittered curve between two settlements
// with a route that actually prefers plains over mountains, and costs
// extra (not prohibitive) to ford a river without a bridge. Binary-heap
// extract-min, not the old linear scan: that version was explicitly
// justified by "mesh is small enough (~1000 cells)", an assumption the grid
// mesh breaks by well over an order of magnitude (tens of thousands of
// cells) -- O(n^2) there would be well over a billion comparisons per road.
// This is O((E+V) log V), same shortest-path result, just reachable in
// bounded time at the new scale.
function computeRoadPath(cells, biomeOf, nearRiverFlag, startIdx, endIdx) {
  const n = cells.length;
  const dist = new Float64Array(n).fill(Infinity);
  const prev = new Int32Array(n).fill(-1);
  const visited = new Uint8Array(n);
  dist[startIdx] = 0;
  const heap = new MinHeap();
  heap.push({ idx: startIdx, dist: 0 });
  while (heap.a.length > 0) {
    const { idx: u, dist: ud } = heap.pop();
    if (visited[u] || ud > dist[u]) continue; // stale heap entry
    visited[u] = 1;
    if (u === endIdx) break;
    for (const v of cells[u].neighbors) {
      if (visited[v]) continue;
      const biome = biomeOf[v];
      if (biome === 'deepwater' || biome === 'shallowwater') continue;
      const d = Math.hypot(cells[u].x - cells[v].x, cells[u].y - cells[v].y);
      const terrainCost = OW_TERRAIN_ROAD_COST[biome] || 1;
      const riverPenalty = nearRiverFlag[v] > 0 ? 1.5 : 1;
      const alt = dist[u] + d * terrainCost * riverPenalty;
      if (alt < dist[v]) { dist[v] = alt; prev[v] = u; heap.push({ idx: v, dist: alt }); }
    }
  }
  if (dist[endIdx] === Infinity) return null;
  const path = [];
  let cur = endIdx;
  while (cur !== -1) { path.push(cur); cur = prev[cur]; }
  path.reverse();
  return path;
}

const OW_TIER_RADIUS = { village: 4.5, town: 6, city: 9 };
const OW_SERIF = 'Georgia, "Palatino Linotype", "Book Antiqua", serif';
const OW_TIER_FONT = {
  village: `10px ${OW_SERIF}`,
  town: `bold 11px ${OW_SERIF}`,
  city: `bold 14px ${OW_SERIF}`,
};

function hexLightness(hex) {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return 50;
  const r = parseInt(m[1], 16), g = parseInt(m[2], 16), b = parseInt(m[3], 16);
  return ((Math.max(r, g, b) + Math.min(r, g, b)) / 2 / 255) * 100;
}

// Region-name text colored to match the terrain underneath it (green over
// forest, brown/olive over hills) instead of one fixed ink color for every
// label -- a consistent convention across every WotC reference reviewed.
// Reuses the wash palette's own hue/saturation rather than adding new
// per-biome label colors. Whether that hue needs to go darker or lighter
// for legibility depends on the theme, not the wash tone's own absolute
// lightness (the wash tones are all moderately dark by design after this
// session's own contrast fix, regardless of whether the theme they belong
// to is otherwise light or dark) -- inferred from the theme's existing
// `label` color, which is already correctly tuned per theme (dark ink on
// parchment/modern's light terrain, light ink on grim's dark terrain).
// Plains/beach/snow/water fall back to the theme's plain label ink,
// matching how those biomes keep their original flat, unwashed treatment.
function labelColorFor(biome, palette) {
  const tone = biome === 'forest' ? palette.wash.forest
    : (biome === 'hills' || biome === 'mountains') ? palette.wash.hills
    : biome === 'barrens' ? palette.wash.barrens
    : null;
  if (!tone) return palette.label;
  const themeIsDark = hexLightness(palette.label) > 50;
  const targetL = themeIsDark ? Math.min(92, tone.l + 45) : Math.max(8, tone.l - 22);
  return `hsl(${tone.h}, ${Math.min(100, tone.s + 15)}%, ${targetL}%)`;
}

// Settlement iconography: a pictorial glyph per tier rather than an
// abstract shape, echoing published-map settlement symbols -- village is a
// small hut, town a single tower, city a three-towered castle -- so tier
// reads at a glance from the icon's silhouette itself, not just its size.
// On-canvas legend: drawn onto the canvas itself (not just the page around
// it) so it travels with an exported/saved PNG, which is the actual
// deliverable pasted into notes -- a page-only legend wouldn't. Always the
// same fixed rows regardless of what's actually present on this particular
// map (a normal legend convention -- it documents the map's visual
// language, not an inventory of this map's contents), and deliberately a
// plain light card regardless of theme, matching how a legend box reads as
// its own neutral overlay on real maps rather than adopting the map's own
// palette.
// `activeZones` (optional) lists the specific wild-zone type OBJECTS that
// actually rolled on THIS map (deduplicated by key) -- not the full ~15-zone
// catalog, which would make the legend enormous and mostly irrelevant to any
// one map. A zone with a washKey gets its own swatch, converted from the
// theme's HSL wash tone into a CSS color the same way paintWatercolorWash
// itself would render it at full opacity; Frostfell (forcesSnow, no washKey
// of its own) shows the ordinary snow swatch, matching what it actually
// paints as (a refBiome override to 'snow', not a distinct recolor).
function drawMapLegend(ctx, canvas, palette, activeZones) {
  const rows = [
    { type: 'swatch', color: palette.biomes.deepwater, label: 'Deep water' },
    { type: 'swatch', color: palette.biomes.shallowwater, label: 'Shallow water' },
    { type: 'swatch', color: palette.biomes.beach, label: 'Beach' },
    { type: 'swatch', color: palette.biomes.plains, label: 'Plains' },
    { type: 'swatch', color: palette.biomes.forest, label: 'Forest' },
    { type: 'swatch', color: palette.biomes.hills, label: 'Hills' },
    { type: 'swatch', color: palette.biomes.mountains, label: 'Mountains' },
    { type: 'swatch', color: palette.biomes.snow, label: 'Snow' },
    { type: 'swatch', color: palette.biomes.barrens, label: 'Barrens' },
    { type: 'icon', tier: 'village', label: 'Village' },
    { type: 'icon', tier: 'town', label: 'Town' },
    { type: 'icon', tier: 'city', label: 'City' },
    { type: 'line', color: palette.river, label: 'River' },
    { type: 'line', color: palette.coastline, label: 'Coastline' },
    { type: 'line', color: palette.road, label: 'Road' },
  ];
  (activeZones || []).forEach((zone) => {
    const color = zone.forcesSnow || !zone.washKey
      ? palette.biomes.snow
      : `hsl(${palette.wash[zone.washKey].h}, ${palette.wash[zone.washKey].s}%, ${palette.wash[zone.washKey].l}%)`;
    rows.push({ type: 'swatch', color, label: zone.label });
  });
  const rowH = 15, padding = 10, swatchSize = 11;
  const boxWidth = 130;
  const boxHeight = rows.length * rowH + padding * 2;
  const boxX = padding, boxY = canvas.height - boxHeight - padding;

  ctx.save();
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.fillRect(boxX, boxY, boxWidth, boxHeight);
  ctx.strokeStyle = 'rgba(0,0,0,0.3)';
  ctx.lineWidth = 1;
  ctx.strokeRect(boxX, boxY, boxWidth, boxHeight);

  ctx.font = `10px ${OW_SERIF}`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';

  rows.forEach((row, i) => {
    const rowY = boxY + padding + i * rowH + rowH / 2;
    const iconX = boxX + padding + swatchSize / 2;
    if (row.type === 'swatch') {
      ctx.fillStyle = row.color;
      ctx.fillRect(iconX - swatchSize / 2, rowY - swatchSize / 2, swatchSize, swatchSize);
    } else if (row.type === 'icon') {
      ctx.fillStyle = '#333333';
      drawSettlementIcon(ctx, row.tier, iconX, rowY, swatchSize * 0.4);
    } else if (row.type === 'line') {
      ctx.strokeStyle = row.color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(iconX - swatchSize / 2, rowY);
      ctx.lineTo(iconX + swatchSize / 2, rowY);
      ctx.stroke();
    }
    ctx.fillStyle = '#1a1a1a';
    ctx.fillText(row.label, boxX + padding + swatchSize + 6, rowY);
  });
  ctx.restore();
}

// Canvas-wide paper-grain mottling, reusing the same makeFbmSampler
// infrastructure lib/noise.js already provides for height/moisture --
// samples a coarse noise field to bias where blotches land (denser/darker
// in low-noise pockets) rather than scattering uniformly at random, which
// would read as flat static instead of the uneven, clouded look real
// parchment has. Drawn once per generate() over the whole canvas, after
// terrain/roads/settlements and before the legend/border, so it reads as
// the page's own material showing through rather than a terrain feature.
// `grain` is the theme's { dark, light, intensity } palette entry --
// intensity lets a theme (Modern Cartography) opt into only a whisper of
// this without a separate code path.
function paintParchmentGrain(ctx, canvas, rng, grain) {
  if (!grain || grain.intensity <= 0) return;
  const w = canvas.width, h = canvas.height;
  const noiseSample = makeFbmSampler(rng, 4);
  // Fine-grained on purpose: an early tuning used a coarse ~15px grid,
  // which at this canvas size reads as distinct soft blobs (looked like
  // mold on the water, not paper fiber) rather than a subtle texture. Real
  // paper grain is much finer than any other texture pass on this map.
  const cols = 130;
  const rows = Math.max(1, Math.round((cols * h) / w));
  const cellW = w / cols, cellH = h / rows;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const u = c / cols, v = r / rows;
      const n = noiseSample(u, v);
      const cx = (c + 0.5) * cellW + (rng() - 0.5) * cellW;
      const cy = (r + 0.5) * cellH + (rng() - 0.5) * cellH;
      const radius = Math.max(0.5, cellW * (0.3 + rng() * 0.4));
      const dark = n < 0.5;
      const tone = dark ? grain.dark : grain.light;
      ctx.globalCompositeOperation = dark ? 'multiply' : 'lighten';
      const alpha = (dark ? 0.025 : 0.015) * grain.intensity;
      ctx.fillStyle = `rgba(${tone.r},${tone.g},${tone.b},${alpha})`;
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.globalCompositeOperation = 'source-over';
}

// A concentric-ring medallion with a small four-pointed glyph at its
// center -- the corner-medallion motif every ornate-bordered reference map
// (Dessarin Valley, Vaasa) uses, in place of this border's previous plain
// L-shaped bracket.
function drawCornerMedallion(ctx, x, y, ink) {
  ctx.save();
  ctx.strokeStyle = ink;
  ctx.globalAlpha = 0.8;
  ctx.lineWidth = 1.4;
  ctx.beginPath(); ctx.arc(x, y, 13, 0, Math.PI * 2); ctx.stroke();
  ctx.lineWidth = 0.8;
  ctx.beginPath(); ctx.arc(x, y, 8.5, 0, Math.PI * 2); ctx.stroke();
  ctx.fillStyle = ink;
  ctx.globalAlpha = 0.85;
  const r = 3.4;
  ctx.beginPath();
  ctx.moveTo(x, y - r); ctx.lineTo(x + r * 0.4, y - r * 0.4);
  ctx.lineTo(x + r, y); ctx.lineTo(x + r * 0.4, y + r * 0.4);
  ctx.lineTo(x, y + r); ctx.lineTo(x - r * 0.4, y + r * 0.4);
  ctx.lineTo(x - r, y); ctx.lineTo(x - r * 0.4, y - r * 0.4);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

// A soft radial vignette, an ornate double-line border with corner
// medallions, and a speckled "aged edge" band -- drawn last, over
// everything else, so it reads as the map's frame rather than something
// terrain/roads/settlements could cover. Reuses palette.coastline (already
// the map's boldest ink accent) rather than adding a new theme key. `rng`
// is a dedicated stream (the aged-edge speckle positions) so this stays
// reproducible per seed like every other generative pass here.
function drawMapVignetteAndBorder(ctx, canvas, ink, rng) {
  const w = canvas.width, h = canvas.height;
  const grad = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.32, w / 2, h / 2, Math.max(w, h) * 0.72);
  grad.addColorStop(0, 'rgba(0,0,0,0)');
  grad.addColorStop(1, 'rgba(0,0,0,0.22)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  ctx.save();
  ctx.strokeStyle = ink;
  const inset = 5;
  ctx.globalAlpha = 0.85;
  ctx.lineWidth = 4;
  ctx.strokeRect(inset, inset, w - inset * 2, h - inset * 2);
  ctx.lineWidth = 1.2;
  ctx.strokeRect(inset + 7, inset + 7, w - (inset + 7) * 2, h - (inset + 7) * 2);

  // Aged edge: a band of small speckles just inside the border, denser
  // near the frame itself and thinning toward the map -- reads as foxing
  // / worn-parchment marks along the page's edge rather than random noise.
  const band = 26;
  const edgeSpeckles = Math.round(((w + h) * 2 * band) / 900);
  ctx.globalAlpha = 1;
  for (let i = 0; i < edgeSpeckles; i++) {
    const side = Math.floor(rng() * 4);
    const along = rng();
    const depth = rng() * rng() * band; // squared bias -- clusters nearer the frame
    let sx, sy;
    if (side === 0) { sx = along * w; sy = inset + depth; }
    else if (side === 1) { sx = w - inset - depth; sy = along * h; }
    else if (side === 2) { sx = along * w; sy = h - inset - depth; }
    else { sx = inset + depth; sy = along * h; }
    ctx.fillStyle = ink;
    ctx.globalAlpha = 0.12 + rng() * 0.15;
    ctx.beginPath();
    ctx.arc(sx, sy, 0.6 + rng() * 1.8, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  for (const [x, y] of [[inset, inset], [w - inset, inset], [inset, h - inset], [w - inset, h - inset]]) {
    drawCornerMedallion(ctx, x, y, ink);
  }
  ctx.restore();
}

// A classic four-point compass rose with emphasized north, drawn in a
// corner clear of the legend/settlement-action panels.
function drawCompassRose(ctx, cx, cy, r, ink) {
  ctx.save();
  ctx.fillStyle = ink;
  ctx.strokeStyle = ink;
  ctx.globalAlpha = 0.85;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();
  for (let i = 0; i < 4; i++) {
    const angle = (Math.PI / 2) * i - Math.PI / 2;
    const len = i === 0 ? r * 1.05 : r * 0.95;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(angle - 0.13) * len * 0.35, cy + Math.sin(angle - 0.13) * len * 0.35);
    ctx.lineTo(cx + Math.cos(angle) * len, cy + Math.sin(angle) * len);
    ctx.lineTo(cx + Math.cos(angle + 0.13) * len * 0.35, cy + Math.sin(angle + 0.13) * len * 0.35);
    ctx.closePath();
    ctx.fill();
  }
  for (let i = 0; i < 4; i++) {
    const angle = (Math.PI / 2) * i - Math.PI / 2 + Math.PI / 4;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(angle) * r * 0.55, cy + Math.sin(angle) * r * 0.55);
    ctx.stroke();
  }
  ctx.font = `bold 11px ${OW_SERIF}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('N', cx, cy - r - 11);
  ctx.restore();
}

// Grid lines + row/col labels over the current canvas, dividing it into
// `tileCols` x `tileRows` equal rectangles -- used both as a live,
// paint-time-only preview overlay (#ow-tile-preview) and to build the
// exported zip's own tile-index.png (see the export-tiles handler below),
// so a printed sheet's rowR-colC filename always matches what this exact
// overlay showed before exporting.
function drawTileGridOverlay(ctx, canvas, palette, tileCols, tileRows) {
  const tileW = canvas.width / tileCols, tileH = canvas.height / tileRows;
  ctx.save();
  ctx.strokeStyle = palette.coastline;
  ctx.globalAlpha = 0.8;
  ctx.lineWidth = 1.5;
  ctx.setLineDash([6, 4]);
  for (let c = 1; c < tileCols; c++) {
    ctx.beginPath();
    ctx.moveTo(c * tileW, 0);
    ctx.lineTo(c * tileW, canvas.height);
    ctx.stroke();
  }
  for (let r = 1; r < tileRows; r++) {
    ctx.beginPath();
    ctx.moveTo(0, r * tileH);
    ctx.lineTo(canvas.width, r * tileH);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.font = `bold 11px ${OW_SERIF}`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  for (let r = 0; r < tileRows; r++) {
    for (let c = 0; c < tileCols; c++) {
      const label = `R${r + 1}C${c + 1}`;
      const x = c * tileW + 4, y = r * tileH + 4;
      ctx.globalAlpha = 0.75;
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      const w = ctx.measureText(label).width;
      ctx.fillRect(x - 2, y - 1, w + 4, 14);
      ctx.globalAlpha = 1;
      ctx.fillStyle = palette.coastline;
      ctx.fillText(label, x, y);
    }
  }
  ctx.restore();
}

function drawSettlementIcon(ctx, tier, cx, cy, r) {
  if (tier === 'village') {
    // A small hut: triangular roof over a low base.
    const w = r * 1.5, roofH = r * 1.15, baseH = r * 0.7;
    ctx.beginPath();
    ctx.moveTo(cx, cy - roofH);
    ctx.lineTo(cx - w / 2, cy);
    ctx.lineTo(cx + w / 2, cy);
    ctx.closePath();
    ctx.fill();
    ctx.fillRect(cx - w * 0.3, cy, w * 0.6, baseH);
    return;
  }
  if (tier === 'town') {
    // A single tower: rectangular body under a pointed roof.
    const w = r * 1.15, bodyH = r * 1.7, roofH = r;
    ctx.beginPath();
    ctx.moveTo(cx, cy - bodyH / 2 - roofH);
    ctx.lineTo(cx - w / 2, cy - bodyH / 2);
    ctx.lineTo(cx + w / 2, cy - bodyH / 2);
    ctx.closePath();
    ctx.fill();
    ctx.fillRect(cx - w / 2, cy - bodyH / 2, w, bodyH);
    return;
  }
  if (tier === 'city') {
    // A three-towered castle -- a taller keep flanked by two shorter
    // towers, each with a crenellated top, echoing a capital-city symbol.
    const towerW = r * 0.55, gap = r * 0.18, bodyH = r * 1.5;
    const merlonW = towerW / 3;
    for (const dx of [-(towerW + gap), 0, towerW + gap]) {
      const h = dx === 0 ? bodyH * 1.2 : bodyH;
      const top = cy - h / 2;
      ctx.fillRect(cx + dx - towerW / 2, top, towerW, h);
      ctx.fillRect(cx + dx - towerW / 2, top - merlonW * 0.6, merlonW, merlonW * 0.6);
      ctx.fillRect(cx + dx + towerW / 2 - merlonW, top - merlonW * 0.6, merlonW, merlonW * 0.6);
    }
    return;
  }
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
}

// Overworld/region map: a regular grid + hydraulic-erosion heightmap
// (lib/terrain-grid.js), replacing the earlier Voronoi-mesh terrain --
// Voronoi cell *boundaries* read as artificial/cellular regardless of how
// much smoothing sat on top of them, since every coastline and biome edge
// was ultimately a straight polygon seam. A grid cell exposes the same
// `{x, y, index, neighbors}` shape a Voronoi cell did, so hydrology, naming
// regions, settlement scoring, and road MST all carry over unchanged;
// rendering shifts from per-cell polygon fill to per-band marching-squares
// contour fill (see the ordered fill pass in generate() below), since grid
// cells have no polygon of their own. lib/voronoi-mesh.js's actual
// Delaunay/Voronoi code is untouched -- views/map-settlement.js still uses
// it for an unrelated generator.
function renderOverworldMap(container) {
  container.innerHTML = `
    <h2>Overworld map generator</h2>
    <div class="map-layout">
      <div class="map-controls">
        <label>Seed <input id="ow-seed" type="number" value="${Math.floor(Math.random() * 1e6)}"></label>
        <label>Theme <select id="ow-theme"></select></label>
        <label>Map scale <select id="ow-scale">
          <option value="standard" selected>Standard</option>
          <option value="continent">Continent</option>
        </select></label>
        <label>Cells <input id="ow-cells" type="number" value="40000" min="10000" max="70000" step="5000"></label>
        <label>Octaves <input id="ow-oct" type="number" value="4" min="1" max="6"></label>
        <label>Sea level <input id="ow-sea" type="range" min="0" max="100" value="42"></label>
        <label>Vegetation <input id="ow-forest-bias" type="range" min="-40" max="40" value="0"></label>
        <label>Ruggedness <input id="ow-rugged-bias" type="range" min="-20" max="20" value="0"></label>
        <label><input id="ow-island" type="checkbox" checked> Island mode</label>
        <label><input id="ow-rivers" type="checkbox" checked> Rivers</label>
        <label><input id="ow-wildzones" type="checkbox" checked> Wild zones</label>
        <label><input id="ow-legend" type="checkbox"> Show legend</label>
        <label>Settlements <input id="ow-settle" type="number" value="6" min="0" max="20"></label>
        <button id="ow-regen">Regenerate</button>
        <hr>
        <button id="ow-export">Export PNG</button>
        <label>Save as <input id="ow-filename" placeholder="filename.png" autocomplete="off"></label>
        <label>Campaign <select id="ow-campaign"></select></label>
        <button id="ow-save">Save to campaign</button>
        <p id="ow-status" class="status-text"></p>
        <hr>
        <button id="ow-export-all">Export all maps (.zip)</button>
        <p id="ow-export-all-status" class="status-text"></p>
        <hr>
        <label>Print tile columns <input id="ow-tile-cols" type="number" value="3" min="1" max="8"></label>
        <label>Print tile rows <input id="ow-tile-rows" type="number" value="3" min="1" max="8"></label>
        <label><input id="ow-tile-preview" type="checkbox"> Preview tile grid</label>
        <button id="ow-export-tiles">Export print tiles (.zip)</button>
        <p id="ow-export-tiles-status" class="status-text"></p>
        <hr>
        <p id="ow-settlement-action" class="status-text"></p>
        <p id="ow-theme-suggestion" class="status-text"></p>
      </div>
      <canvas id="ow-canvas" width="800" height="600"></canvas>
    </div>
  `;

  populateCampaignSelect(container.querySelector('#ow-campaign'));
  populateThemeSelect(container.querySelector('#ow-theme'));

  const canvas = container.querySelector('#ow-canvas');
  // `let`, not `const` -- wireMapExportSave's high-res export temporarily
  // points this at an offscreen context so generate() redraws there instead
  // of the on-screen canvas, then restores it.
  let ctx = canvas.getContext('2d');

  // Retained across generate() calls so the click handler below (registered
  // once) can always hit-test against the settlements from the MOST RECENT
  // draw -- canvas has no native per-shape click events, so hit-testing has
  // to work from this remembered screen-position list rather than the DOM.
  let currentSeed = 0;
  let currentSettlements = [];

  // Hydraulic erosion is a one-time cost (~0.3-0.9s at this grid's
  // resolution, measured in the Step 0 prototype) that must never re-run on
  // a live Vegetation/Ruggedness slider tick. Those sliders only reclassify
  // the already-computed height/moisture field (biomeAt's forestBias/
  // ruggedBias) -- and per convention #3, settlement placement, naming, and
  // road routing all key off the *unbiased* refBiome and must stay fixed
  // under the sliders too. That means everything below except the final
  // LIVE `biome` field and all rendering is a pure function of
  // {seed, cellCount, octaves, island, seaLevel, riversOn, settleCount} --
  // none of which a live-drag tick ever changes -- so it all belongs in one
  // cache, not just the height field. Missing this the first time through
  // this rewrite left road routing's own (now-correct, but still real)
  // Dijkstra cost running on every slider tick, which alone made fast-mode
  // ticks take as long as a full regenerate -- caught by actually timing a
  // live-drag tick against this real render, not assumed fast because the
  // algorithmic complexity fix was in place.
  // Continent-scale generation is gated entirely behind cellCount exceeding
  // today's Standard-tier ceiling -- at or below it, every branch below
  // takes the exact `rangeCount === 1` / `canvas.width===800` path this
  // generator already ships, byte-for-byte. This makes "does Standard still
  // render pixel-identical to before" a mechanical fact, not an assumption.
  const CONTINENT_CELL_THRESHOLD = 70000;

  let worldCache = null;
  function buildWorld(seed, cellCount, octaves, island, seaLevel, riversOn, settleCount, wildZonesOn) {
    // canvas.width/height join the key the moment canvas size can vary
    // (the Continent preset uses a bigger canvas) -- without this, switching
    // scale tiers could silently reuse a mesh/heightmap sized for the wrong
    // canvas. wildZonesOn joins it for the same reason the other checkboxes
    // already do: toggling it must never silently reuse a world built (or
    // not built) with the wild-zone tables applied the other way.
    const key = [seed, cellCount, octaves, island, seaLevel, riversOn, settleCount, wildZonesOn, canvas.width, canvas.height].join('|');
    if (worldCache && worldCache.key === key) return worldCache;

    const meshRng = mulberry32(seed + 77777);
    const mesh = buildTerrainGrid(meshRng, canvas.width, canvas.height, cellCount);
    const { cols, rows, cellW, cellH } = mesh;

    // Height = isotropic base terrain (rolling variation, unchanged) + a
    // RIDGED mountain layer -- confirmed as the actual complaint (not a
    // guess) via AskUserQuestion after the account owner rejected the first
    // grid+erosion pass outright: "landmass is a blob", "mountains are
    // round dots, not ranges", "rivers are too sparse/short". At Standard
    // scale that's ONE range, sampled through a rotated/stretched
    // coordinate frame so it reads as a real long axis instead of isotropic
    // blobbiness. At Continent scale, a single stretched range would just
    // be a bigger single-mountain island, not a continent -- so above
    // CONTINENT_CELL_THRESHOLD this becomes `rangeCount` independent,
    // separated ranges (lib/noise.js's makeMountainRange), each with its
    // own rng stream, placed via rejection sampling with a PER-PAIR
    // required separation derived from the two ranges' own sizes (a
    // standalone prototype confirmed a simpler count-only separation
    // formula lets ranges as long as 0.4x the map radius fuse together at
    // rangeCount 5-8; sizing the gap off actual range extents instead
    // fixed it at every tested count). Island-mode falloff uses a wobbly
    // (non-circular) radius regardless of tier, so the coastline's GROSS
    // shape has real large-scale bays/headlands instead of erosion just
    // adding fine wiggle to a mathematically perfect circle.
    const heightRng = mulberry32(seed);
    const heightSample = makeFbmSampler(heightRng, octaves);
    const cx = canvas.width / 2, cy = canvas.height / 2, maxD = Math.hypot(cx, cy);

    const rangeCount = cellCount > CONTINENT_CELL_THRESHOLD
      ? Math.max(3, Math.min(8, Math.round(cellCount / 35000)))
      : 1;
    // Blend weights differ by branch, not just the ridge source: the
    // Standard-tier ridgedSample has no envelope at all (makeAnisotropicSampler
    // warps the WHOLE canvas), so it contributes a nonzero baseline height
    // everywhere, not just near "the range." makeMountainRange's envelope is
    // exactly 0 outside its ellipse by design (that's what keeps multiple
    // ranges from smearing together) -- but that means most of a continent's
    // area (outside the few range footprints) gets NO ridge contribution at
    // all, so it needs a bigger base-terrain weight to still produce ordinary
    // land there. Verified directly, not assumed: at the unchanged Standard
    // weights (0.5 base / 0.75 ridge), a continent-scale test seed produced
    // 0% pre-erosion land; 0.95/0.5 matched that seed's Standard-tier land
    // fraction (~12-13%) closely.
    // Island/coastline shape params are decided FIRST now (before ranges),
    // because at Continent scale both the coastline AND the mountain
    // placement need to share the same geological "grain." An earlier
    // version of this concentrated every range into a belt hugging one
    // coastal margin, reasoning from real-world convergent-plate tectonics
    // (Andes/Rockies/Himalaya) after the account owner rejected a centered
    // blob of ranges -- but directly comparing against real fantasy
    // continent maps (Faerun, Middle-earth, Westeros -- actually looked at
    // the images, not recalled from memory) showed that isn't the pattern
    // fantasy cartography actually uses: all three have SEVERAL separate,
    // independently-placed mountain clusters, often functioning as interior
    // dividers between regions (Middle-earth's Misty/White/Mordor ranges
    // bound Gondor, Rohan, Eriador, Mordor from each other) rather than one
    // coastal belt. What those three maps all clearly have that this
    // generator was still missing is coastline complexity: none of them are
    // remotely close to a wobbled ellipse -- Faerun has a sea cutting deep
    // into the interior, Westeros has deep bays on both sides plus Dorne
    // hanging off as its own lobe on a narrow isthmus. So ranges go back to
    // independent placement (keeping the per-pair size-based separation fix,
    // which genuinely worked), and the coastline itself becomes a UNION of
    // several elongated "lobes" (lib/noise.js's makeLobeFalloff, the same
    // smooth-elliptical-falloff math as makeMountainRange's envelope, just
    // without the noise) placed along a shared long axis with a bay-carving
    // pass on top -- lobes that fully overlap read as one connected body;
    // lobes that only just touch read as a peninsula on a narrow neck.
    // Standard-tier (rangeCount === 1) is untouched, still the original
    // plain-circle formula.
    const islandRng = mulberry32(seed + 80808);
    const continentAngle = rangeCount > 1 ? islandRng() * Math.PI : 0;
    const cosA = Math.cos(continentAngle), sinA = Math.sin(continentAngle);
    let lobeFalloffFns = null;
    if (rangeCount > 1) {
      const lobeCount = 3 + Math.floor(islandRng() * 2); // 3-4
      lobeFalloffFns = [];
      for (let i = 0; i < lobeCount; i++) {
        const alongFrac = (i + 0.5) / lobeCount - 0.5; // evenly spaced along the spine, -0.5..0.5
        // Sent an early version of this without actually looking at the
        // rendered output first -- it was badly broken, most seeds
        // producing almost no land at all. Root cause, found by directly
        // measuring average lobe coverage across the canvas (0.18, i.e.
        // most of the frame was outside every lobe): lobe size vs. spacing
        // was tuned by eye, not measured, and radii this small relative to
        // how far apart the lobes spread left huge gaps between them.
        // These sizes/spread are chosen from an actual land-fraction sweep
        // across 6 seeds (targeting a similar land coverage to the single-
        // lobe Continent tier that already read correctly).
        const along = alongFrac * maxD * 0.95 + (islandRng() - 0.5) * maxD * 0.15;
        const across = (islandRng() - 0.5) * maxD * 0.12;
        const px = cx + along * cosA - across * sinA, py = cy + along * sinA + across * cosA;
        const lengthRadius = maxD * (0.65 + islandRng() * 0.30);
        const widthRadius = maxD * (0.48 + islandRng() * 0.22);
        const lobeAngle = continentAngle + (islandRng() - 0.5) * 0.35;
        lobeFalloffFns.push(makeLobeFalloff(px, py, lobeAngle, lengthRadius, widthRadius));
      }
    }
    const radiusWobble = makeRadialWobbleSampler(islandRng, 6);
    const islandBaseRadius = 0.72;
    const islandWobbleAmp = 0.32;
    // Hard margin taper for the lobe-union coastline only: an elongated lobe
    // (lengthRadius up to 0.95*maxD) can genuinely reach the canvas edge in
    // several disconnected places, which the Standard-tier wobbled circle
    // (tuned to stay just inside effectiveMaxDist<=~1.04*maxD, never
    // touching the frame) never does. Found by direct measurement, not
    // assumption: extractFillableRegions's landLoop for a broken continent
    // render had 5 separate points pinned exactly to the canvas boundary,
    // and closeContourChains's border-stitching (built for a landmass that
    // spans the WHOLE frame edge-to-edge, island mode off) connected them
    // into one degenerate loop whose shoelace area was 88% of the canvas
    // but whose evenodd-filled pixels were under 2% -- i.e. almost nothing
    // actually painted, exactly matching the "empty ocean" bug report.
    // Fading land to 0 within a fixed margin of every edge guarantees no
    // lobe ever reaches the border, so this code path is never exercised;
    // confirmed by re-running the same loop-extraction against the same
    // seed with this taper applied: edge touches dropped to 0 and the
    // painted land area matched the raw land fraction again.
    const edgeMarginX = canvas.width * 0.035, edgeMarginY = canvas.height * 0.035;
    function edgeFalloff(x, y) {
      const fx = Math.min(x, canvas.width - x) / edgeMarginX;
      const fy = Math.min(y, canvas.height - y) / edgeMarginY;
      return smoothstep(Math.max(0, Math.min(1, Math.min(fx, fy))));
    }

    // landFloor stays 0 on the Standard-tier (rangeCount === 1) path, so the
    // shared height formula below reduces to the exact original expression
    // there -- this only changes anything for the multi-range branch.
    let ridgeContribution, baseWeight, ridgeWeight, landFloor = 0;
    // Populated only in the multi-range branch below -- `ranges` keeps each
    // range's own envelope function addressable by index (the shared
    // ridgeContribution above only ever needed their max), and
    // `rangeZoneOf[r]` is which RANGE_ZONE_TYPES entry (or null) that range
    // rolled, for the wild-zone overlay pass in generate().
    let ranges = null, rangeZoneOf = null;
    if (rangeCount === 1) {
      const ridgeRng = mulberry32(seed + 70707);
      const ridgeAngle = ridgeRng() * Math.PI;
      const baseRidged = makeRidgedFbmSampler(ridgeRng, Math.min(5, octaves + 1));
      const ridgedSample = makeAnisotropicSampler(baseRidged, ridgeAngle, 1.0, 2.8);
      ridgeContribution = (x, y) => ridgedSample(x / canvas.width, y / canvas.height);
      baseWeight = 0.5; ridgeWeight = 0.75;
    } else {
      // Range centers are independent again (uniform-by-area disc sample,
      // not tied to any one coastal margin) -- keeping the per-pair
      // required-separation fix (sized off the two ranges' own extents,
      // 1.4x their combined length radii), which a standalone prototype
      // already confirmed prevents ranges from fusing at higher counts.
      const rangeSpawnRng = mulberry32(seed + 40404);
      const specs = [];
      for (let r = 0; r < rangeCount; r++) {
        const rangeSeed = Math.floor(rangeSpawnRng() * 0xFFFFFFFF);
        const rangeRng = mulberry32(rangeSeed);
        const angle = rangeRng() * Math.PI;
        const lengthRadius = maxD * (0.18 + rangeRng() * 0.16);
        const widthRadius = lengthRadius / (2.8 + rangeRng() * 2.0);
        specs.push({ rangeRng, angle, lengthRadius, widthRadius });
      }
      const centers = [];
      for (let r = 0; r < rangeCount; r++) {
        let best = null, bestSlack = -Infinity;
        for (let attempt = 0; attempt < 30; attempt++) {
          const ang = rangeSpawnRng() * Math.PI * 2;
          const rad = Math.sqrt(rangeSpawnRng()) * maxD * 0.6;
          const px = cx + Math.cos(ang) * rad, py = cy + Math.sin(ang) * rad;
          let minSlack = centers.length ? Infinity : 1;
          for (let j = 0; j < centers.length; j++) {
            const required = (specs[r].lengthRadius + specs[j].lengthRadius) * 1.4;
            minSlack = Math.min(minSlack, Math.hypot(centers[j].x - px, centers[j].y - py) - required);
          }
          if (minSlack > bestSlack) { bestSlack = minSlack; best = { x: px, y: py }; }
          if (minSlack >= 0) break;
        }
        centers.push(best);
      }
      ranges = centers.map((c, i) => {
        const ridged = makeRidgedFbmSampler(specs[i].rangeRng, Math.min(5, octaves + 1));
        return makeMountainRange(ridged, c.x, c.y, specs[i].angle, specs[i].lengthRadius, specs[i].widthRadius);
      });
      ridgeContribution = (x, y) => {
        let m = 0;
        for (const s of ranges) m = Math.max(m, s(x, y));
        return m;
      };
      // Range-zone wild zones (Blighted Wasteland, Volcanic Ashlands,
      // Crystal Wastes, Elemental Scar, Obsidian Flats, Cloudpiercer Peaks)
      // -- Continent tier only, an explicit scope boundary rather than a
      // degraded Standard-tier fallback. One roll per range from its own
      // rng stream (derived from rangeSpawnRng so it stays isolated from
      // every other continent-tier stream), independent of whether the
      // account owner has wild zones on at all -- gated at consumption
      // time in generate() instead, so a toggle flip never needs a
      // different world cached.
      const rangeZoneRng = mulberry32(seed + 46213);
      rangeZoneOf = centers.map(() => {
        if (rangeZoneRng() > 0.22) return null;
        return RANGE_ZONE_TYPES[Math.floor(rangeZoneRng() * RANGE_ZONE_TYPES.length)];
      });
      // Previously baseWeight=0.95 alone had to guarantee land clears sea
      // level everywhere a lobe covers, not just near a range -- but that
      // same 0.95 weight on isotropic base-terrain noise (which routinely
      // swings well above its own average) ALSO pushed large low-frequency
      // patches of ordinary interior terrain, far from any real range, past
      // hillsT on its own. Confirmed directly: rendering and looking at the
      // output, several seeds (1001, 271828) showed one giant continuous
      // "highland" wash across most of the landmass instead of a few
      // distinct ranges -- because extractFillableRegions's hillsT contour
      // doesn't distinguish "real range" from "noise happened to be high
      // here," a contiguous elevated patch of base terrain merges visually
      // with the actual range footprints into one blob under the single
      // combined highland wash (the "one continuous highland tone" this
      // generator already uses on purpose, matching real reference maps).
      // Splitting the old single baseWeight into a flat landFloor (does the
      // "guarantee land clears sea level" job alone) plus a much smaller
      // noise amplitude (baseWeight here, now just adding modest variation
      // on top of that floor, rarely enough on its own to cross hillsT)
      // fixes this without touching land coverage: verified via a land/
      // biome-fraction sweep across seeds 1001/271828/42/8008 that this
      // combination keeps land fraction in the same ~11-16% range as
      // before while dropping "hills+ far from any range" to ~0 on every
      // seed tested (was up to 13% before, enough to bridge separate range
      // footprints into one blob for an unlucky noise draw).
      landFloor = 0.40; baseWeight = 0.20; ridgeWeight = 0.55;
    }

    // Which single range (if any) dominates each cell -- kept separate from
    // the shared ridgeContribution max above, which only needed the
    // envelope VALUE, not WHICH range produced it. Only meaningful (and
    // only computed) in the multi-range branch; a small nonzero floor keeps
    // cells far from every range (ridge value near 0, i.e. genuinely not
    // part of any range) correctly unassigned rather than nominally
    // "belonging" to whichever range happened to be weakly largest there.
    const rangeIndexOf = ranges ? new Int32Array(mesh.cells.length).fill(-1) : null;
    const heights = new Float64Array(mesh.cells.length);
    mesh.cells.forEach((cell, i) => {
      const u = cell.x / canvas.width, v = cell.y / canvas.height;
      let h = landFloor + heightSample(u, v) * baseWeight + ridgeContribution(cell.x, cell.y) * ridgeWeight;
      if (ranges) {
        let bestVal = 0.05, bestIdx = -1;
        for (let r = 0; r < ranges.length; r++) {
          const val = ranges[r](cell.x, cell.y);
          if (val > bestVal) { bestVal = val; bestIdx = r; }
        }
        rangeIndexOf[i] = bestIdx;
      }
      if (island) {
        const dx = cell.x - cx, dy = cell.y - cy;
        const theta = Math.atan2(dy, dx);
        if (lobeFalloffFns) {
          let lobeMax = 0;
          for (const fn of lobeFalloffFns) lobeMax = Math.max(lobeMax, fn(cell.x, cell.y));
          // Only the INWARD half of the wobble carves bays/fjords into the
          // lobe union -- it never extends land beyond what the lobes
          // themselves already define, so this can only cut the coastline,
          // never inflate it into something the lobe placement didn't
          // intend.
          const bayCarve = Math.max(0, -radiusWobble(theta)) * 0.4;
          h *= Math.max(0, lobeMax - bayCarve) * edgeFalloff(cell.x, cell.y);
        } else {
          const dist = Math.hypot(dx, dy) / maxD;
          const effectiveMaxDist = islandBaseRadius + radiusWobble(theta) * islandWobbleAmp;
          const t = dist / effectiveMaxDist;
          h *= Math.max(0, 1 - t * t * 1.3);
        }
      }
      heights[i] = h;
    });

    // Guarantee ONE connected landmass (the resolved design decision -- an
    // archipelago was explicitly rejected in favor of "one bounded
    // landmass") instead of hoping the lobe union happens to connect.
    // Lobes overlap generously by construction (lengthRadius up to
    // 0.95*maxD, far bigger than the ~0.3*maxD spacing between adjacent
    // centers), but confirmed directly by rendering and looking at the
    // actual output: seeds 42 and 8008 both produced two separate islands
    // (the gap between lobes has a nonzero but sub-sea-level union value),
    // linked only by a road drawn straight across open water -- while seed
    // 1001 happened to connect fine. Re-tuning lobe geometry by trial and
    // error against a handful of seeds is exactly how the earlier near-
    // empty-ocean regression got introduced, so instead this detects actual
    // disconnection via flood fill and carves a land bridge to the nearest
    // point of the main landmass -- correct for every seed by construction,
    // not just the ones spot-checked.
    if (island && lobeFalloffFns) {
      const labels = new Int32Array(heights.length).fill(-1);
      const components = [];
      for (let start = 0; start < heights.length; start++) {
        if (labels[start] !== -1 || heights[start] < seaLevel) continue;
        const compIdx = components.length;
        const cellsIn = [];
        const queue = [start];
        labels[start] = compIdx;
        while (queue.length) {
          const idx = queue.pop();
          cellsIn.push(idx);
          const r = Math.floor(idx / cols), c = idx % cols;
          if (r > 0 && labels[idx - cols] === -1 && heights[idx - cols] >= seaLevel) { labels[idx - cols] = compIdx; queue.push(idx - cols); }
          if (r < rows - 1 && labels[idx + cols] === -1 && heights[idx + cols] >= seaLevel) { labels[idx + cols] = compIdx; queue.push(idx + cols); }
          if (c > 0 && labels[idx - 1] === -1 && heights[idx - 1] >= seaLevel) { labels[idx - 1] = compIdx; queue.push(idx - 1); }
          if (c < cols - 1 && labels[idx + 1] === -1 && heights[idx + 1] >= seaLevel) { labels[idx + 1] = compIdx; queue.push(idx + 1); }
        }
        components.push(cellsIn);
      }
      if (components.length > 1) {
        components.sort((a, b) => b.length - a.length);
        // Bounded sample of each component for nearest-pair search -- an
        // exhaustive O(main * other) pass over every land cell would be far
        // too slow at continent cell counts, and a bridge only needs a
        // reasonably close pair of points, not the mathematically closest.
        function sampleCells(cellsIn, n) {
          if (cellsIn.length <= n) return cellsIn;
          const out = [];
          const step = cellsIn.length / n;
          for (let i = 0; i < n; i++) out.push(cellsIn[Math.floor(i * step)]);
          return out;
        }
        const mainSample = sampleCells(components[0], 400);
        const bridgeWidth = Math.max(cellW, cellH) * 6;
        for (let k = 1; k < components.length; k++) {
          const compSample = sampleCells(components[k], 200);
          let bestDist = Infinity, bestA = null, bestB = null;
          for (const a of mainSample) {
            const ar = Math.floor(a / cols), ac = a % cols;
            const ax = (ac + 0.5) * cellW, ay = (ar + 0.5) * cellH;
            for (const b of compSample) {
              const br = Math.floor(b / cols), bc = b % cols;
              const bx = (bc + 0.5) * cellW, by = (br + 0.5) * cellH;
              const d = (ax - bx) * (ax - bx) + (ay - by) * (ay - by);
              if (d < bestDist) { bestDist = d; bestA = { x: ax, y: ay }; bestB = { x: bx, y: by }; }
            }
          }
          const dxB = bestB.x - bestA.x, dyB = bestB.y - bestA.y;
          const len = Math.hypot(dxB, dyB) || 1;
          const ux = dxB / len, uy = dyB / len;
          const minR = Math.max(0, Math.floor(Math.min(bestA.y, bestB.y) / cellH) - 8);
          const maxR = Math.min(rows - 1, Math.ceil(Math.max(bestA.y, bestB.y) / cellH) + 8);
          const minC = Math.max(0, Math.floor(Math.min(bestA.x, bestB.x) / cellW) - 8);
          const maxC = Math.min(cols - 1, Math.ceil(Math.max(bestA.x, bestB.x) / cellW) + 8);
          for (let r = minR; r <= maxR; r++) {
            for (let c = minC; c <= maxC; c++) {
              const px = (c + 0.5) * cellW, py = (r + 0.5) * cellH;
              const t = (px - bestA.x) * ux + (py - bestA.y) * uy;
              if (t < 0 || t > len) continue;
              const projX = bestA.x + ux * t, projY = bestA.y + uy * t;
              const perpDist = Math.hypot(px - projX, py - projY);
              if (perpDist > bridgeWidth) continue;
              const idx = r * cols + c;
              const target = seaLevel + 0.05 * (1 - perpDist / bridgeWidth);
              if (heights[idx] < target) heights[idx] = target;
            }
          }
        }
      }
    }

    // Erosion pipeline (lib/terrain-grid.js), matching the Step 0 prototype
    // exactly: pit-fill before erosion so hydrology below doesn't inherit
    // the raw noise field's own tiny pits, hydraulic + thermal erosion for
    // the actual organic shaping, then a second pit-fill pass since erosion
    // itself introduces new small single-cell pits. Droplet count tapers
    // above the Continent threshold: a channel's visual footprint is a few
    // cells wide regardless of grid size, so once density is high enough
    // for several droplets to already trace the same channel, more
    // droplets-per-cell mostly re-carve ground already carved rather than
    // add new distinguishable detail -- trading those diminishing-return
    // iterations for real wall-clock savings. At cellCount <=
    // CONTINENT_CELL_THRESHOLD this produces the exact existing default
    // ({}), unchanged.
    const erosionRng = mulberry32(seed + 50505);
    const erosionParams = {};
    if (cellCount > CONTINENT_CELL_THRESHOLD) {
      const scale = Math.sqrt(CONTINENT_CELL_THRESHOLD / cellCount);
      erosionParams.dropletCount = Math.round(cols * rows * Math.max(0.6, 1.5 * scale));
    }
    fillPits(heights, cols, rows, seaLevel);
    applyHydraulicErosion(heights, cols, rows, erosionRng, erosionParams);
    applyThermalErosion(heights, cols, rows, 3, 0.025, 0.5);
    fillPits(heights, cols, rows, seaLevel);

    // Naming regions: generic adjacency BFS, independent of biome/height
    // beyond the adjacency graph itself.
    const regionRng = mulberry32(seed + 22222);
    const regionCount = Math.max(2, Math.min(8, Math.round(cellCount / 60)));
    const regionOf = assignNamingRegions(mesh.cells, regionCount, regionRng);

    // Hydrology: a deterministic function of heights/seaLevel. The cosmetic
    // river-curve wobble stays a per-render concern (this session's earlier
    // per-segment jitter was replaced by whole-chain chaikinSmooth
    // threading -- see the river rendering pass below), but the underlying
    // flow/downhill/lake data and river threshold are pure functions of the
    // cached height field and belong here.
    let flow = null, downhill = null, isLake = null, riverThreshold = Infinity;
    let lakeIdOf = null, largestLakeId = -1;
    const nearRiver = new Float64Array(mesh.cells.length);
    if (riversOn) {
      const hydro = computeHydrology(mesh.cells, heights, seaLevel);
      flow = hydro.flow; downhill = hydro.downhill; isLake = hydro.isLake;
      const landCells = [];
      for (let i = 0; i < mesh.cells.length; i++) if (heights[i] >= seaLevel) landCells.push(i);
      riverThreshold = riverFlowThreshold(flow, landCells, 0.04, 3);
      for (let i = 0; i < mesh.cells.length; i++) {
        if (flow[i] < riverThreshold && !isLake[i]) continue;
        nearRiver[i] = Math.max(nearRiver[i], 1);
        for (const nb of mesh.cells[i].neighbors) nearRiver[nb] = Math.max(nearRiver[nb], 0.5);
      }
      // Scrying Pool needs to single out ONE lake (the largest) -- isLake
      // alone is a per-cell flag with no notion of which cells belong to
      // the same lake versus a different, unconnected one.
      const lakeLabels = labelLakes(mesh.cells, isLake);
      lakeIdOf = lakeLabels.lakeIdOf;
      largestLakeId = lakeLabels.sizes[lakeLabels.largestId] >= 6 ? lakeLabels.largestId : -1;
    }

    // Moisture (river-adjacency bump already folded in) and refBiome are
    // both bias-independent -- forestBias/ruggedBias only affect the LIVE
    // `biome` field, computed fresh per render in generate() itself.
    // At Continent scale (rangeCount > 1), a single coarse regional field
    // nudges moisture so different parts of the landmass have a different
    // character (a drier interior, a wetter coast) instead of one
    // statistically-uniform field repeated everywhere -- blended directly
    // into `m` rather than threaded through biomeAt as a new parameter,
    // since biomeAt only ever compares `moist > forestT` regardless of
    // where that moisture value came from.
    const moistureSample = makeFbmSampler(mulberry32(seed + 99991), Math.max(1, octaves - 1));
    const regionalMoisture = rangeCount > 1 ? makeFbmSampler(mulberry32(seed + 91919), 2) : null;
    const mOf = new Float64Array(mesh.cells.length);
    const refBiomeOf = new Array(mesh.cells.length);
    mesh.cells.forEach((cell, i) => {
      let m = moistureSample(cell.x / canvas.width, cell.y / canvas.height);
      if (regionalMoisture) {
        const regional = regionalMoisture(cell.x / canvas.width, cell.y / canvas.height);
        m = m * 0.75 + regional * 0.25;
      }
      m = Math.min(1, m + nearRiver[i] * 0.3);
      mOf[i] = m;
      refBiomeOf[i] = biomeAt(heights[i], m, seaLevel, 0, 0);
    });

    // Wetlowland: a derived flag, not a new base biome (Bone Marsh/Feywild
    // Bog are wild-zone content layered on ordinary plains/beach, not
    // baseline terrain in their own right) -- a wet low-lying cell, gated
    // on moisture OR river-adjacency so a marsh reads as "near water"
    // either way. refBiomeOf itself never changes for these cells, so
    // naming/settlement/road logic downstream is completely untouched.
    const wetlowlandHillsT = Math.max(seaLevel + 0.08, 0.55);
    const marshMoistureT = 0.62;
    const wetlowlandOf = new Uint8Array(mesh.cells.length);
    for (let i = 0; i < mesh.cells.length; i++) {
      const rb = refBiomeOf[i];
      wetlowlandOf[i] = (rb === 'plains' || rb === 'beach') && heights[i] < wetlowlandHillsT &&
        (mOf[i] > marshMoistureT || nearRiver[i] > 0) ? 1 : 0;
    }

    // Resolve each naming region to a phoneme category by tallying its
    // cells' refBiomes and taking the majority. The same pass also tracks,
    // per region, whether each SPECIAL_ZONE_TYPES baseBiome actually has a
    // matching cell there at all -- consulted below so a region never gets
    // assigned a zone type that would render as nothing (e.g. Ashen Forest
    // rolled for a region with no forest cells).
    const regionBiomeTally = [];
    const regionHasBase = [];
    for (let r = 0; r < regionCount; r++) { regionBiomeTally.push({}); regionHasBase.push({ forest: false, hills: false, barrens: false, wetlowland: false, any: false }); }
    for (let i = 0; i < mesh.cells.length; i++) {
      const tally = regionBiomeTally[regionOf[i]];
      const category = BIOME_TO_NAME_CATEGORY[refBiomeOf[i]] || 'plains';
      tally[category] = (tally[category] || 0) + 1;
      const hasBase = regionHasBase[regionOf[i]];
      if (heights[i] >= seaLevel) hasBase.any = true;
      const rb = refBiomeOf[i];
      if (rb === 'forest') hasBase.forest = true;
      else if (rb === 'hills') hasBase.hills = true;
      else if (rb === 'barrens') hasBase.barrens = true;
      if (wetlowlandOf[i]) hasBase.wetlowland = true;
    }
    const regionCategory = regionBiomeTally.map((tally) => {
      let best = 'plains', bestCount = -1;
      for (const category in tally) { if (tally[category] > bestCount) { bestCount = tally[category]; best = category; } }
      return best;
    });

    // Special wild zones (Ashen Forest, Petrified Wastes, Thornwood, Fungal
    // Forest, Bone Marsh, Feywild Bog, Bloodstone Desert, Salt Flats,
    // Frostfell) -- reuses the naming regions above directly rather than a
    // separate region system; their contiguous boundaries make a coherent
    // zone shape for free. One roll per region, filtered to types whose
    // baseBiome gate actually has a matching cell in THAT region, capped
    // at 2 zoned regions per map so a whole continent doesn't turn into a
    // patchwork. Rolled unconditionally (like rangeZoneOf above) and gated
    // at consumption time in generate(), so toggling #ow-wildzones never
    // needs a different cached world.
    const zoneRng = mulberry32(seed + 46617);
    const regionZoneOf = new Array(regionCount).fill(null);
    let zonedRegionCount = 0;
    for (let r = 0; r < regionCount; r++) {
      if (zonedRegionCount >= 2) break;
      if (zoneRng() > 0.15) continue;
      const eligible = SPECIAL_ZONE_TYPES.filter((z) => regionHasBase[r][z.baseBiome] || z.baseBiome === 'any');
      if (eligible.length === 0) continue;
      regionZoneOf[r] = eligible[Math.floor(zoneRng() * eligible.length)];
      zonedRegionCount++;
    }
    // Frostfell overrides refBiome itself (a forced snow cap, not a
    // recolor) -- applied here, once, to the cached field, so it stays
    // structural like naming/settlements/roads rather than re-rolling on
    // every live slider drag.
    for (let i = 0; i < mesh.cells.length; i++) {
      const zone = regionZoneOf[regionOf[i]];
      if (zone && zone.forcesSnow && heights[i] >= seaLevel) refBiomeOf[i] = 'snow';
    }

    // Settlements: refBiome-keyed candidate scoring/placement/tiers/names,
    // matching Phase 9's "sculpt without losing what's already settled".
    const settleRng = mulberry32(seed + 60606);
    const nameRng = mulberry32(seed + 33333);
    const candidates = [];
    for (let i = 0; i < mesh.cells.length; i++) {
      const refBiome = refBiomeOf[i];
      if (refBiome === 'plains' || refBiome === 'beach' || refBiome === 'hills') {
        const riverBonus = nearRiver[i] > 0 ? 0.25 : 0;
        candidates.push({ x: mesh.cells[i].x, y: mesh.cells[i].y, index: i, score: settleRng() + (refBiome === 'plains' ? 0.3 : 0) + riverBonus });
      }
    }
    candidates.sort((a, b) => b.score - a.score);
    const minDist = Math.max(canvas.width, canvas.height) / (settleCount + 1) * 0.6;
    const settlements = [];
    for (const c of candidates) {
      if (settlements.length >= settleCount) break;
      if (settlements.every((s) => Math.hypot(s.x - c.x, s.y - c.y) >= minDist)) settlements.push(c);
    }
    const byScore = settlements.slice().sort((a, b) => b.score - a.score);
    const cityCount = Math.max(1, Math.round(byScore.length * 0.15));
    const townCount = Math.max(0, Math.round(byScore.length * 0.35));
    byScore.forEach((s, i) => {
      s.tier = i < cityCount ? 'city' : i < cityCount + townCount ? 'town' : 'village';
      s.name = generateSettlementName(nameRng, s.tier, regionCategory[regionOf[s.index]]);
    });

    // Point-feature wild-zone landmarks (Ley Line Nexus, Astral Scar,
    // Giant's Garden, Sunken Ruins) -- porting the single-landmark pattern
    // already shipped in map-detail.js's generate(), but scattered across
    // naming regions (at most one per region, capped overall) instead of
    // one center-biased pick, since an overworld-scale map has room for
    // more than one. Rolled unconditionally, gated at consumption time in
    // generate() like the other two wild-zone tables.
    const landmarkRng = mulberry32(seed + 68219);
    const shallowwaterAdjacent = new Uint8Array(mesh.cells.length);
    for (let i = 0; i < mesh.cells.length; i++) {
      if (refBiomeOf[i] !== 'shallowwater') continue;
      for (const nb of mesh.cells[i].neighbors) {
        if (heights[nb] >= seaLevel + 0.03) shallowwaterAdjacent[nb] = 1;
      }
    }
    const landmarks = [];
    const LANDMARK_CAP = 4;
    const minLandmarkDist = Math.max(canvas.width, canvas.height) * 0.06;
    for (let r = 0; r < regionCount && landmarks.length < LANDMARK_CAP; r++) {
      const category = regionCategory[r];
      const pool = (POINT_LANDMARK_TYPES[category] || []).concat(POINT_LANDMARK_TYPES.any);
      if (pool.length === 0) continue;
      const type = pool[Math.floor(landmarkRng() * pool.length)];
      if (landmarkRng() > (type.rare ? 0.10 : 0.30)) continue;
      const candidates = [];
      for (let i = 0; i < mesh.cells.length; i++) {
        if (regionOf[i] !== r || heights[i] < seaLevel + 0.03) continue;
        if (type.placement === 'shallowwaterAdjacent' ? !shallowwaterAdjacent[i] : (refBiomeOf[i] === 'hills' || refBiomeOf[i] === 'mountains' || refBiomeOf[i] === 'snow')) continue;
        candidates.push(i);
      }
      if (candidates.length === 0) continue;
      const idx = candidates[Math.floor(landmarkRng() * candidates.length)];
      const px = mesh.cells[idx].x, py = mesh.cells[idx].y;
      const tooClose = settlements.some((s) => Math.hypot(s.x - px, s.y - py) < minLandmarkDist) ||
        landmarks.some((l) => Math.hypot(l.x - px, l.y - py) < minLandmarkDist);
      if (tooClose) continue;
      const baseName = generateSettlementName(landmarkRng, 'village', category);
      landmarks.push({ x: px, y: py, key: type.key, label: type.label, name: `${type.label} of ${baseName}` });
    }

    // Roads: MST connection choice AND each connection's actual Dijkstra
    // route, both computed once here -- neither depends on anything the
    // live sliders touch, and at this grid's scale (tens of thousands of
    // nodes) re-running Dijkstra per slider tick is exactly the cost this
    // cache exists to avoid.
    const roadPaths = [];
    if (settlements.length > 1) {
      const connected = new Set([0]);
      while (connected.size < settlements.length) {
        let best = null;
        for (const i of connected) {
          for (let j = 0; j < settlements.length; j++) {
            if (connected.has(j)) continue;
            const d = Math.hypot(settlements[i].x - settlements[j].x, settlements[i].y - settlements[j].y);
            if (!best || d < best.d) best = { i, j, d };
          }
        }
        if (!best) break;
        const a = settlements[best.i], b = settlements[best.j];
        const path = computeRoadPath(mesh.cells, refBiomeOf, nearRiver, a.index, b.index);
        if (path && path.length > 1) {
          const pts = path.map((idx) => ({ x: mesh.cells[idx].x, y: mesh.cells[idx].y }));
          roadPaths.push(pts.length > 2 ? chaikinSmooth(pts, 1) : pts);
        } else {
          // No routable land path (e.g. the two settlements are on separate
          // islands) -- a direct line still gets drawn rather than silently
          // vanishing.
          roadPaths.push([{ x: a.x, y: a.y }, { x: b.x, y: b.y }]);
        }
        connected.add(best.j);
      }
    }

    worldCache = {
      key, mesh, heights, cols, rows, cellW, cellH,
      mOf, refBiomeOf, flow, downhill, isLake, riverThreshold, nearRiver,
      regionOf, regionCategory, settlements, roadPaths,
      wetlowlandOf, rangeIndexOf, rangeZoneOf, regionZoneOf,
      lakeIdOf, largestLakeId, landmarks,
    };
    return worldCache;
  }

  // Builds one path from every closed loop in `loops` -- shared by the two
  // helpers below, which differ only in what they do with that path.
  // Smoothing (see smoothLoops below) is applied by the caller, selectively,
  // rather than in here -- applying it unconditionally to every band fill
  // (forest/barrens/highland/snow/wild-zone/lake, on top of the coastline
  // loops) measured at ~2.1s added at Continent tier's 250k-cell ceiling,
  // which is real enough to matter for a Regenerate click. Only the loops
  // that actually define the coastline silhouette get smoothed.
  function pathFromLoops(loops) {
    ctx.beginPath();
    for (const loop of loops) {
      ctx.moveTo(loop[0].x, loop[0].y);
      for (let i = 1; i < loop.length; i++) ctx.lineTo(loop[i].x, loop[i].y);
      ctx.closePath();
    }
  }
  // Rounds off the raw marching-squares polygon extractFillableRegions
  // returns -- used selectively (just the water/beach/land loops that
  // actually define the coastline silhouette, see generate() below) rather
  // than inside pathFromLoops itself, since smoothing every band fill
  // (forest/barrens/highland/snow/wild-zone/lake, dozens of loops each
  // generate()) measured at ~2.1s added at Continent tier's 250k-cell
  // ceiling -- real enough to matter for a Regenerate click, and those
  // interior band edges weren't what read as jagged in the first place.
  // Even scoped to just the coastline loops, the cost turned out to be
  // dominated by point COUNT, not iteration count -- a single Chaikin pass
  // on a Continent-tier coastline (many thousands of marching-squares
  // points) still cost the same ~2.1s (measured directly: 348ms raw, 2456ms
  // at one iteration, no meaningful difference at two). Decimating to a
  // fixed point budget BEFORE smoothing fixes this at the actual source --
  // Chaikin's whole purpose is rounding corners, which doesn't need every
  // single grid-cell-edge vertex to begin with, so this loses only
  // redundant, sub-visible detail. `capacity` bounds the corner-cutting
  // curve to the same visual precision regardless of loop size, so Standard
  // and Continent tier read the same amount of "roundedness".
  function smoothLoops(loops, iterations) {
    const capacity = 600;
    return loops.map((loop) => {
      const stride = Math.max(1, Math.floor(loop.length / capacity));
      const decimated = stride > 1 ? loop.filter((_, i) => i % stride === 0) : loop;
      return chaikinSmoothClosed(decimated, iterations);
    });
  }
  // Fills every closed loop in `loops` together in one path using the
  // evenodd rule -- correctly punches out interior holes (an enclosed
  // below-threshold pocket inside an above-threshold region, e.g. a small
  // lake inside a landmass) and handles any number of disjoint regions at
  // once, with no separate outer-vs-hole classification needed.
  function fillLoopsEvenOdd(loops, fillStyle) {
    if (loops.length === 0) return;
    ctx.fillStyle = fillStyle;
    pathFromLoops(loops);
    ctx.fill('evenodd');
  }
  // Clips to the union of `loops` (evenodd) without painting anything --
  // for restricting a later fill (e.g. the forest wash) to a region already
  // computed for an earlier fill, instead of re-extracting it.
  function clipToLoops(loops) {
    pathFromLoops(loops);
    ctx.clip('evenodd');
  }

  // `fast` skips the multi-layer watercolor wash and rosette/tree icon
  // passes -- the two most expensive additions in this rendering pass --
  // for the live-dragging Vegetation/Ruggedness feedback loop, which needs
  // to redraw on every slider tick. The flat band fills (already using the
  // muted wash tone, not the old saturated flat color) still apply in fast
  // mode, so a drag-in-progress still looks reasonably close to the final
  // result, just without the mottled texture until the drag settles
  // (scheduleLiveRegen's trailing full-quality redraw, wired below) or the
  // user hits Regenerate/changes the theme.
  function generate(fast) {
    const seed = parseInt(container.querySelector('#ow-seed').value, 10) || 1;
    const cellCount = parseInt(container.querySelector('#ow-cells').value, 10) || 40000;
    const octaves = parseInt(container.querySelector('#ow-oct').value, 10) || 4;
    const seaLevel = parseInt(container.querySelector('#ow-sea').value, 10) / 100;
    const forestBias = parseInt(container.querySelector('#ow-forest-bias').value, 10) / 100;
    const ruggedBias = parseInt(container.querySelector('#ow-rugged-bias').value, 10) / 100;
    const island = container.querySelector('#ow-island').checked;
    const riversOn = container.querySelector('#ow-rivers').checked;
    const legendOn = container.querySelector('#ow-legend').checked;
    const settleCount = parseInt(container.querySelector('#ow-settle').value, 10) || 0;
    const wildZonesOn = container.querySelector('#ow-wildzones').checked;
    const theme = MAP_THEMES[container.querySelector('#ow-theme').value] || MAP_THEMES[MAP_THEME_DEFAULT];
    const palette = theme.overworld;

    // Thresholds mirror biomeAt's own internal formulas exactly (kept in
    // sync by hand -- biomeAt still owns per-cell classification for
    // settlement/road/theme-suggestion logic below; these copies are only
    // for driving marching-squares contour extraction against the same
    // continuous fields).
    const hillsT = Math.max(seaLevel + 0.08, 0.55 - ruggedBias);
    const mountainsT = Math.max(hillsT + 0.05, 0.7 - ruggedBias);
    const snowT = Math.max(mountainsT + 0.05, 0.85 - ruggedBias);
    const forestT = Math.min(0.9, Math.max(0.1, 0.5 - forestBias));
    const aridT = Math.max(0, Math.min(forestT - 0.15, 0.22 - forestBias * 0.5));

    // Dedicated rngs for every LIVE (per-render) generative concern --
    // biome texture, wash, grain, border -- fully isolated from each other
    // and from everything buildWorld() below consumes only on a cache miss
    // (mesh geometry, erosion, naming, moisture, settlement scoring/names,
    // road choice). `riverCurveRng`/`nameRng`/`regionRng`/`settleRng` moved
    // into buildWorld with the concerns they belong to -- river rendering
    // now threads whole polylines (chaikinSmooth) rather than jittering
    // each cell-to-cell hop, so the old per-segment curve wobble stream is
    // gone entirely, not just relocated.
    const textureRng = mulberry32(seed + 55555);
    const themeSuggestRng = mulberry32(seed + 67890);
    const washRng = mulberry32(seed + 44444);
    const rosetteRng = mulberry32(seed + 88888);
    const grainRng = mulberry32(seed + 13579);
    const borderRng = mulberry32(seed + 24680);

    const world = buildWorld(seed, cellCount, octaves, island, seaLevel, riversOn, settleCount, wildZonesOn);
    const {
      mesh, heights, cols, rows, cellW, cellH,
      mOf, refBiomeOf, flow, downhill, isLake, riverThreshold, nearRiver,
      regionOf, regionCategory, settlements, roadPaths,
      wetlowlandOf, rangeIndexOf, rangeZoneOf, regionZoneOf,
      lakeIdOf, largestLakeId, landmarks,
    } = world;

    // `biome` is the LIVE classification (Vegetation/Ruggedness sliders
    // applied) used for the actual fill colors/texture/legend/theme-
    // suggestion stats below -- cheap to recompute every render (a plain
    // threshold check per cell against the already-cached height/moisture).
    // `refBiome` comes straight from the cache: settlement placement,
    // naming regions, and road routing were all built against it already,
    // so dragging a slider only repaints the terrain's coloring and never
    // moves a settlement, renames a region, or reroutes a road.
    const cellData = mesh.cells.map((cell, i) => ({
      cell, h: heights[i], m: mOf[i],
      biome: biomeAt(heights[i], mOf[i], seaLevel, forestBias, ruggedBias),
      refBiome: refBiomeOf[i],
    }));

    // Rendering shifts from per-cell polygon fill (grid cells have none) to
    // ordered per-band marching-squares contour fill: each successive call
    // extracts the closed-loop region where the driving field crosses one
    // threshold (extractFillableRegions handles chain-threading AND
    // border-stitching for any region touching the canvas edge -- island
    // mode off, or any landmass spanning the frame, hits this on every
    // regenerate) and paints it on top of everything painted so far. Because
    // every height-based band is a superlevel set of the SAME monotonic
    // height field, this "paint low elevation first, higher elevation over
    // it" order alone gets nested bands (hills sitting inside a
    // deepwater-to-snow gradient) AND interior holes (a lake enclosed by a
    // mountain mass) correct with no separate hole classification: a hole
    // at a lower true elevation just shows through as whatever was painted
    // in an earlier, lower-threshold pass. fillLoopsEvenOdd's evenodd rule
    // additionally handles multiple disjoint regions and any interior holes
    // *within* one threshold's own extraction, regardless of winding.
    // Discards sub-cell-scale marching-squares noise (a height field can
    // cross a threshold by a hair within a single grid block) -- left in,
    // each such micro-loop still gets a full band fill or (worse) its own
    // paintWatercolorWash call sized for a real region, reading as a small,
    // out-of-place dark blob rather than any real terrain feature.
    const minLoopArea = cellW * cellH * 0.5;
    const heightAt = (i) => heights[i];
    ctx.fillStyle = palette.biomes.deepwater;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    fillLoopsEvenOdd(
      smoothLoops(extractFillableRegions(cols, rows, cellW, cellH, heightAt, seaLevel - 0.08, canvas.width, canvas.height, minLoopArea), 2),
      palette.biomes.shallowwater
    );
    // beachLoops/landLoops themselves stay RAW -- reused below for the
    // coastline emphasis stroke (its own chaikinSmooth call) and for
    // clipToLoops, neither of which needs (or should pay twice for) a
    // pre-smoothed copy. Only the fill gets the smoothed version.
    const beachLoops = extractFillableRegions(cols, rows, cellW, cellH, heightAt, seaLevel, canvas.width, canvas.height, minLoopArea);
    fillLoopsEvenOdd(smoothLoops(beachLoops, 2), palette.biomes.beach);
    const landLoops = extractFillableRegions(cols, rows, cellW, cellH, heightAt, seaLevel + 0.03, canvas.width, canvas.height, minLoopArea);
    fillLoopsEvenOdd(smoothLoops(landLoops, 2), palette.biomes.plains);

    // Fixed-pixel texture scatter (tree/rosette/plains-lean/beach-dot/snow-
    // cross), replacing the old one-call-per-Voronoi-cell placement -- the
    // grid has far more, far smaller cells than the old mesh, so iterating
    // it directly would place tens of thousands of icons. Sampling at a
    // fixed pixel spacing instead decouples icon density from the terrain
    // grid's own resolution, matching roughly the old default's visual
    // density regardless of how high the Cells slider is set. Each sample
    // looks up its biome via an O(1) nearest-grid-cell index, not a
    // point-in-polygon test against a marching-squares contour's (much
    // larger) vertex list.
    const spacing = Math.max(16, Math.min(canvas.width, canvas.height) / 24);
    function biomeAtPoint(x, y) {
      const gx = Math.min(cols - 1, Math.max(0, Math.floor(x / cellW)));
      const gy = Math.min(rows - 1, Math.max(0, Math.floor(y / cellH)));
      return cellData[gy * cols + gx].biome;
    }
    for (let sy = spacing / 2; sy < canvas.height; sy += spacing) {
      for (let sx = spacing / 2; sx < canvas.width; sx += spacing) {
        const px = sx + (textureRng() - 0.5) * spacing * 0.6;
        const py = sy + (textureRng() - 0.5) * spacing * 0.6;
        const biome = biomeAtPoint(px, py);
        if (biome === 'hills' || biome === 'mountains' || biome === 'forest' || biome === 'barrens') continue; // wash+icon pass below, gated by !fast
        paintBiomeTexture(ctx, biome, px, py, spacing, spacing, textureRng, palette.ink);
      }
    }

    if (!fast) {
      // Forest wash: a contour on MOISTURE (not height) -- but moisture
      // itself is sampled over the WHOLE canvas independent of land/water
      // (unlike height, it was never masked to the landmass), so a raw
      // moisture threshold can flag a high-moisture patch out in open
      // ocean, far from any coastline. Such a patch routinely touches all
      // four canvas edges (nothing ties it to where the actual coastline
      // is), and border-stitching that into a loop produced a near-
      // full-canvas region that then got misread as almost entirely
      // "hole" once grouped -- the forest wash silently painted nothing
      // anywhere, confirmed by sampling known forest cells and finding
      // the plains color underneath instead. Masking moisture to land
      // (anything below the beach-or-higher threshold reads as
      // definitely-not-forest) before extraction keeps the resulting
      // region inherently bounded by the real coastline, so it only ever
      // touches the border when the LAND itself does -- the case
      // border-stitching is actually meant to handle.
      const landForestAt = (i) => (heights[i] >= seaLevel + 0.03 ? cellData[i].m : -1);
      const forestLoops = extractFillableRegions(cols, rows, cellW, cellH, landForestAt, forestT, canvas.width, canvas.height, minLoopArea);
      if (forestLoops.length > 0) {
        ctx.save();
        clipToLoops(landLoops.length ? landLoops : beachLoops);
        for (const group of groupChainsIntoLoops(forestLoops)) {
          paintWatercolorWash(ctx, group, washRng, palette.wash.forest, palette.ink, 28);
        }
        ctx.restore();
      }

      // Barrens wash: symmetric to the forest wash above, just on the
      // opposite (low-moisture) side of biomeAt's aridT threshold -- passing
      // `1 - m` and thresholding on `1 - aridT` reuses extractFillableRegions'
      // superlevel-set extraction without needing a second sub-level-set
      // code path. Needed because the base land fill is a single flat
      // plains color regardless of moisture (see landLoops fill above) --
      // without an overlay wash, barrens cells would be invisible under it,
      // same reason forest needs this same treatment.
      const landBarrensAt = (i) => (heights[i] >= seaLevel + 0.03 ? 1 - cellData[i].m : -1);
      const barrensLoops = extractFillableRegions(cols, rows, cellW, cellH, landBarrensAt, 1 - aridT, canvas.width, canvas.height, minLoopArea);
      if (barrensLoops.length > 0) {
        ctx.save();
        clipToLoops(landLoops.length ? landLoops : beachLoops);
        for (const group of groupChainsIntoLoops(barrensLoops)) {
          paintWatercolorWash(ctx, group, washRng, palette.wash.barrens, palette.ink, 28);
        }
        ctx.restore();
      }

      // Hills+mountains+snow wash: one combined highland tone (matching
      // real reference maps, which show a single continuous highland wash
      // rather than two abutting flat colors); hills/mountains stay visually
      // distinct via the rosette icon pass, snow via its own flat fill on
      // top afterward.
      const highlandLoops = extractFillableRegions(cols, rows, cellW, cellH, heightAt, hillsT, canvas.width, canvas.height, minLoopArea);
      for (const group of groupChainsIntoLoops(highlandLoops)) {
        paintWatercolorWash(ctx, group, washRng, palette.wash.hills, palette.ink, 28);
      }

      for (let sy = spacing / 2; sy < canvas.height; sy += spacing) {
        for (let sx = spacing / 2; sx < canvas.width; sx += spacing) {
          const px = sx + (textureRng() - 0.5) * spacing * 0.6;
          const py = sy + (textureRng() - 0.5) * spacing * 0.6;
          const biome = biomeAtPoint(px, py);
          if (biome === 'hills' || biome === 'mountains') {
            paintRosetteTexture(ctx, px, py, spacing, spacing, rosetteRng, palette.ink, biome === 'mountains');
          } else if (biome === 'forest' || biome === 'barrens') {
            paintBiomeTexture(ctx, biome, px, py, spacing, spacing, textureRng, palette.ink);
          }
        }
      }

      // Wild zones: additive overlays painted AFTER the normal terrain
      // passes above, so a map that rolled none renders byte-for-byte
      // identical to before this system existed, and toggling
      // #ow-wildzones off just skips this block entirely (no different
      // cached world needed -- regionZoneOf/rangeZoneOf/landmarks are
      // always computed in buildWorld, gated only here at paint time).
      if (wildZonesOn) {
        // Special zones (band-threshold reflavors) -- one region at a
        // time, recoloring only the cells that already matched both that
        // region AND the zone's baseBiome (or wetlowlandOf for the two
        // wetlowland-gated types). Frostfell has no wash/icon of its own
        // (it overrides refBiome to 'snow' back in buildWorld, so it's
        // already painted by the ordinary snow fill below).
        for (let r = 0; r < regionZoneOf.length; r++) {
          const zone = regionZoneOf[r];
          if (!zone || zone.forcesSnow) continue;
          const zoneAt = (i) => {
            if (regionOf[i] !== r) return 0;
            const match = zone.baseBiome === 'wetlowland' ? wetlowlandOf[i] : (cellData[i].refBiome === zone.baseBiome ? 1 : 0);
            return match ? 1 : 0;
          };
          const zoneLoops = extractFillableRegions(cols, rows, cellW, cellH, zoneAt, 0.5, canvas.width, canvas.height, minLoopArea);
          if (zoneLoops.length === 0) continue;
          for (const group of groupChainsIntoLoops(zoneLoops)) {
            paintWatercolorWash(ctx, group, washRng, palette.wash[zone.washKey], palette.ink, 24);
          }
          for (let sy = spacing / 2; sy < canvas.height; sy += spacing) {
            for (let sx = spacing / 2; sx < canvas.width; sx += spacing) {
              const px = sx + (textureRng() - 0.5) * spacing * 0.6;
              const py = sy + (textureRng() - 0.5) * spacing * 0.6;
              const gx = Math.min(cols - 1, Math.max(0, Math.floor(px / cellW)));
              const gy = Math.min(rows - 1, Math.max(0, Math.floor(py / cellH)));
              if (!zoneAt(gy * cols + gx)) continue;
              drawWildZoneIcon(ctx, px, py, zone.iconKey, palette.ink);
            }
          }
        }

        // Range zones (Continent tier only -- rangeIndexOf/rangeZoneOf are
        // both null at Standard tier, so this loop simply never runs
        // there). 'range' recolors that range's whole hillsT+ footprint;
        // 'rangeBase' only its hillsT..mountainsT foothill band;
        // 'snowOnly' (Cloudpiercer Peaks) changes nothing but the icon at
        // that range's own existing snow-cap cells.
        if (rangeZoneOf) {
          for (let r = 0; r < rangeZoneOf.length; r++) {
            const zone = rangeZoneOf[r];
            if (!zone) continue;
            if (zone.appliesTo === 'snowOnly') {
              for (let sy = spacing / 2; sy < canvas.height; sy += spacing) {
                for (let sx = spacing / 2; sx < canvas.width; sx += spacing) {
                  const px = sx + (textureRng() - 0.5) * spacing * 0.6;
                  const py = sy + (textureRng() - 0.5) * spacing * 0.6;
                  const gx = Math.min(cols - 1, Math.max(0, Math.floor(px / cellW)));
                  const gy = Math.min(rows - 1, Math.max(0, Math.floor(py / cellH)));
                  const gi = gy * cols + gx;
                  if (rangeIndexOf[gi] !== r || heights[gi] < snowT) continue;
                  drawWildZoneIcon(ctx, px, py, zone.iconKey, palette.ink);
                }
              }
              continue;
            }
            const highCut = zone.appliesTo === 'rangeBase' ? mountainsT : Infinity;
            const zoneAt = (i) => (rangeIndexOf[i] === r && heights[i] >= hillsT && heights[i] < highCut) ? 1 : 0;
            const zoneLoops = extractFillableRegions(cols, rows, cellW, cellH, zoneAt, 0.5, canvas.width, canvas.height, minLoopArea);
            if (zoneLoops.length === 0) continue;
            for (const group of groupChainsIntoLoops(zoneLoops)) {
              paintWatercolorWash(ctx, group, washRng, palette.wash[zone.washKey], palette.ink, 24);
            }
            for (let sy = spacing / 2; sy < canvas.height; sy += spacing) {
              for (let sx = spacing / 2; sx < canvas.width; sx += spacing) {
                const px = sx + (textureRng() - 0.5) * spacing * 0.6;
                const py = sy + (textureRng() - 0.5) * spacing * 0.6;
                const gx = Math.min(cols - 1, Math.max(0, Math.floor(px / cellW)));
                const gy = Math.min(rows - 1, Math.max(0, Math.floor(py / cellH)));
                if (!zoneAt(gy * cols + gx)) continue;
                drawWildZoneIcon(ctx, px, py, zone.iconKey, palette.ink);
              }
            }
          }
        }
      }
    }

    // Snow flat-fills last, on top of the highland wash's peak.
    fillLoopsEvenOdd(
      extractFillableRegions(cols, rows, cellW, cellH, heightAt, snowT, canvas.width, canvas.height, minLoopArea),
      palette.biomes.snow
    );

    // Coastline: the same land/water threshold as the beach fill above,
    // reused rather than re-extracted -- the extra-ink glow/stroke below is
    // specific to the land/water boundary (it reads as more significant
    // than a biome-to-biome seam), so it still gets its own emphasis pass.
    ctx.lineJoin = 'round';
    for (const chain of beachLoops) {
      const smoothed = chaikinSmooth(chain, 3);
      ctx.beginPath();
      ctx.moveTo(smoothed[0].x, smoothed[0].y);
      for (let i = 1; i < smoothed.length; i++) ctx.lineTo(smoothed[i].x, smoothed[i].y);
      ctx.closePath();
      // A soft glow band under the crisp ink line -- the same path stroked
      // twice, wide/faint then thin/solid -- echoes the halo published maps
      // often put around a coastline instead of a single flat rule.
      ctx.strokeStyle = palette.coastline;
      ctx.globalAlpha = 0.18;
      ctx.lineWidth = 7;
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    let riverSegmentCount = 0;
    if (riversOn) {
      // River networks are threaded into whole polylines (source to sea),
      // not stroked as thousands of individual tiny cell-to-cell hops the
      // way the old, much coarser Voronoi mesh could get away with -- at
      // grid resolution each hop is only a couple pixels, so per-hop
      // stroking would mean tens of thousands of draw calls for a jagged,
      // not smoother, result. A cell is a river "source" if it qualifies
      // but has no qualifying upstream neighbor already draining into it;
      // walking downhill from each source and stopping at an
      // already-visited (already-drawn) cell avoids re-stroking a shared
      // trunk once two branches merge. Line width is set once per chain
      // from its widest (most downstream) point rather than tapering
      // per-hop -- a deliberate simplification versus the old per-segment
      // taper, easy to revisit after this pass gets a visual look.
      const n = mesh.cells.length;
      const hasUpstream = new Uint8Array(n);
      for (let i = 0; i < n; i++) {
        if (flow[i] >= riverThreshold && downhill[i] !== -1) hasUpstream[downhill[i]] = 1;
      }
      const visitedDown = new Uint8Array(n);
      ctx.strokeStyle = palette.river;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      for (let s = 0; s < n; s++) {
        if (flow[s] < riverThreshold || hasUpstream[s]) continue;
        const chain = [{ x: mesh.cells[s].x, y: mesh.cells[s].y }];
        let maxFlow = flow[s];
        let cur = s;
        for (;;) {
          const next = downhill[cur];
          if (next === -1) break;
          chain.push({ x: mesh.cells[next].x, y: mesh.cells[next].y });
          maxFlow = Math.max(maxFlow, flow[next]);
          riverSegmentCount++;
          if (visitedDown[next]) break; // merged into an already-drawn trunk
          visitedDown[next] = 1;
          if (heights[next] < seaLevel || flow[next] < riverThreshold) break; // reached the sea
          cur = next;
        }
        if (chain.length < 2) continue;
        const smoothed = chaikinSmooth(chain, 2);
        ctx.lineWidth = Math.min(6, 1 + Math.sqrt(maxFlow / riverThreshold));
        ctx.beginPath();
        ctx.moveTo(smoothed[0].x, smoothed[0].y);
        for (let i = 1; i < smoothed.length; i++) ctx.lineTo(smoothed[i].x, smoothed[i].y);
        ctx.stroke();
      }

      // Lakes as real extracted shapes (marching squares on the isLake
      // flag, same machinery as every other band above) instead of a
      // per-cell dot scatter -- a lake spanning several adjacent grid cells
      // reads as one clean blob rather than a cluster of overlapping
      // circles.
      const lakeVal = (i) => (isLake[i] && flow[i] >= 2 ? 1 : 0);
      const lakeLoops = extractFillableRegions(cols, rows, cellW, cellH, lakeVal, 0.5, canvas.width, canvas.height, minLoopArea);
      fillLoopsEvenOdd(lakeLoops, palette.lake);

      // Scrying Pool: decorates only the SINGLE LARGEST lake (largestLakeId,
      // labeled once in buildWorld via lib/hydrology.js's labelLakes --
      // isLake alone can't tell separate lakes apart). -1 when no lake
      // cleared the minimum size there, so this is a clean no-op on a
      // lake-free (or only-puddles) seed.
      if (wildZonesOn && largestLakeId !== -1) {
        let sumX = 0, sumY = 0, n = 0;
        for (let i = 0; i < mesh.cells.length; i++) {
          if (lakeIdOf[i] !== largestLakeId) continue;
          sumX += mesh.cells[i].x; sumY += mesh.cells[i].y; n++;
        }
        if (n > 0) drawWildZoneIcon(ctx, sumX / n, sumY / n, 'scryingPool', palette.ink);
      }
    }

    // Settlements and roadPaths come straight from the cache (world) --
    // candidate scoring, placement, tiers, names, MST choice, and each
    // connection's Dijkstra route were all computed once in buildWorld(),
    // since none of it depends on anything the live sliders touch. Here we
    // only draw them.
    ctx.strokeStyle = palette.road;
    ctx.lineWidth = 2;
    for (const pts of roadPaths) {
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
      ctx.stroke();
    }

    for (const s of settlements) {
      const px = s.x, py = s.y;
      const r = OW_TIER_RADIUS[s.tier];
      ctx.fillStyle = palette.settlement[s.tier];
      drawSettlementIcon(ctx, s.tier, px, py, r);
      if (s.tier === 'city') {
        ctx.strokeStyle = palette.settlement[s.tier];
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(px, py, r + 3, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.font = OW_TIER_FONT[s.tier];
      // refBiome, not the live-biased biome -- matches convention #3
      // (settlement-adjacent visuals stay fixed under the live sliders).
      ctx.fillStyle = labelColorFor(cellData[s.index].refBiome, palette);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText(s.name, px, py + r + 3);
    }

    // Point-feature wild-zone landmarks (Ley Line Nexus, Astral Scar,
    // Giant's Garden, Sunken Ruins) -- placed once in buildWorld,
    // drawn here the same way settlements are: straight from the cache,
    // no live-slider dependence.
    if (wildZonesOn) {
      ctx.font = `${OW_TIER_FONT.village}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      for (const lm of landmarks) {
        drawWildZoneIcon(ctx, lm.x, lm.y, lm.key, palette.ink);
        ctx.fillStyle = palette.label;
        ctx.fillText(lm.name, lm.x, lm.y + 9);
      }
    }

    paintParchmentGrain(ctx, canvas, grainRng, palette.grain);

    if (legendOn) {
      // Whichever wild-zone types actually rolled on THIS map, deduplicated
      // by key -- the account owner correctly pointed out that a colored
      // patch with no legend entry reads as unexplained, not as content.
      const activeZones = [];
      const seenZoneKeys = new Set();
      if (wildZonesOn) {
        for (const zone of regionZoneOf) {
          if (zone && !seenZoneKeys.has(zone.key)) { seenZoneKeys.add(zone.key); activeZones.push(zone); }
        }
        if (rangeZoneOf) {
          for (const zone of rangeZoneOf) {
            if (zone && !seenZoneKeys.has(zone.key)) { seenZoneKeys.add(zone.key); activeZones.push(zone); }
          }
        }
      }
      drawMapLegend(ctx, canvas, palette, activeZones);
    }

    drawCompassRose(ctx, canvas.width - 50, 50, 28, palette.coastline);
    drawMapVignetteAndBorder(ctx, canvas, palette.coastline, borderRng);

    // Print-tile grid preview: paint-time only overlay (like #ow-wildzones'
    // own icons), drawn last/on top so the grid lines and row/col labels
    // stay legible over everything already painted -- lets the user check
    // tile boundaries land somewhere sensible before spending the time to
    // actually export every tile.
    if (container.querySelector('#ow-tile-preview').checked) {
      drawTileGridOverlay(ctx, canvas, palette,
        parseInt(container.querySelector('#ow-tile-cols').value, 10) || 1,
        parseInt(container.querySelector('#ow-tile-rows').value, 10) || 1);
    }

    // Suggested campaign theme: a heuristic read of this specific map's own
    // statistics (biome mix, settlement tiers, river count, island-ness),
    // not anything the map's rendering needs -- computed last, purely from
    // data already on hand.
    const landBiomeCounts = { plains: 0, forest: 0, hills: 0, mountains: 0, snow: 0, barrens: 0 };
    let beachCount = 0, landCount = 0;
    for (const { biome } of cellData) {
      if (biome === 'deepwater' || biome === 'shallowwater') continue;
      landCount++;
      if (biome === 'beach') { beachCount++; continue; }
      if (landBiomeCounts[biome] !== undefined) landBiomeCounts[biome]++;
    }
    const landNonBeachCount = Math.max(1, landCount - beachCount);
    const biomeFraction = {};
    for (const k in landBiomeCounts) biomeFraction[k] = landBiomeCounts[k] / landNonBeachCount;
    const tierCounts = { village: 0, town: 0, city: 0 };
    for (const s of settlements) tierCounts[s.tier]++;
    const coastalSettlementFraction = settlements.length
      ? settlements.filter((s) => regionCategory[regionOf[s.index]] === 'coastal').length / settlements.length
      : 0;
    const mapStats = {
      landFraction: landCount / cellData.length,
      beachFraction: beachCount / cellData.length,
      biome: biomeFraction,
      settlementCount: settlements.length,
      tierCounts,
      riverCount: riverSegmentCount,
      islandMode: island,
      coastalSettlementFraction,
    };
    const themeSuggestion = suggestCampaignTheme(mapStats, themeSuggestRng);
    container.querySelector('#ow-theme-suggestion').textContent = `Suggested campaign theme: ${themeSuggestion}`;

    currentSeed = seed;
    currentSettlements = settlements;
    container.querySelector('#ow-settlement-action').innerHTML = '';
  }

  // Canvas has no native per-shape click events, so hit-testing is manual:
  // convert the click point from CSS pixels to the canvas's own internal
  // resolution (max-width:100% can scale the element down from its 800x600
  // backing store on a narrow viewport, so offsetX/offsetY alone would be
  // wrong there) and compare against each settlement's last-drawn position.
  function canvasToInternal(evt) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return { x: (evt.clientX - rect.left) * scaleX, y: (evt.clientY - rect.top) * scaleY };
  }
  function hitTestSettlement(evt) {
    const { x, y } = canvasToInternal(evt);
    let best = null, bestIdx = -1, bestDist = Infinity;
    currentSettlements.forEach((s, i) => {
      const r = OW_TIER_RADIUS[s.tier] + 6; // a little padding makes small village markers easier to hit
      const d = Math.hypot(s.x - x, s.y - y);
      if (d <= r && d < bestDist) { best = s; bestIdx = i; bestDist = d; }
    });
    return best ? { settlement: best, idx: bestIdx } : null;
  }
  // Empty-terrain click target for "zoom in" (map/detail). Reads worldCache
  // directly rather than the generate()-local cellData/biomeAtPoint (which
  // vanish once generate() returns) -- worldCache is the one piece of
  // per-cell data that survives across renders in this closure, same reason
  // the persistent settlement click handler below already relies on it via
  // currentSettlements.
  // Which wild zone (if any) actually covers a given cell -- checked
  // directly against regionZoneOf/rangeZoneOf, not just "is #ow-wildzones
  // on," so a cell outside every rolled zone still reads as zone-less even
  // when the checkbox is on. Region zones take priority (a cell is never in
  // both at once in practice, but region zones are the more common case).
  // Factored out of hitTestLand so the landmark click path below can look up
  // the SAME zone a landmark's cell might sit in, without a second,
  // independently-drifting copy of the elevation-band gate (rangeIndexOf
  // tracks the spatially NEAREST range by noise-envelope value regardless of
  // a cell's own height, so this mirrors the render pass's own
  // hillsT/mountainsT/snowT formulas exactly -- confirmed directly as a real
  // bug once already: without this gate, a beach cell near, not on, a
  // Volcanic Ashlands range still reported that range's zone).
  function zoneAtCell(idx) {
    const { regionOf, regionZoneOf, rangeIndexOf, rangeZoneOf, heights } = worldCache;
    let zone = regionZoneOf[regionOf[idx]] || null;
    if (!zone && rangeIndexOf && rangeZoneOf) {
      const rIdx = rangeIndexOf[idx];
      const candidate = rIdx !== -1 ? rangeZoneOf[rIdx] : null;
      if (candidate) {
        const ruggedBias = parseInt(container.querySelector('#ow-rugged-bias').value, 10) / 100;
        const seaLevel = parseInt(container.querySelector('#ow-sea').value, 10) / 100;
        const hillsT = Math.max(seaLevel + 0.08, 0.55 - ruggedBias);
        const mountainsT = Math.max(hillsT + 0.05, 0.7 - ruggedBias);
        const snowT = Math.max(mountainsT + 0.05, 0.85 - ruggedBias);
        const h = heights[idx];
        const inBand = candidate.appliesTo === 'snowOnly' ? h >= snowT
          : candidate.appliesTo === 'rangeBase' ? (h >= hillsT && h < mountainsT)
          : h >= hillsT;
        if (inBand) zone = candidate;
      }
    }
    return zone;
  }
  function hitTestLand(evt) {
    if (!worldCache) return null;
    const { x, y } = canvasToInternal(evt);
    if (x < 0 || y < 0 || x >= canvas.width || y >= canvas.height) return null;
    const { cols, rows, cellW, cellH, refBiomeOf } = worldCache;
    const gx = Math.min(cols - 1, Math.max(0, Math.floor(x / cellW)));
    const gy = Math.min(rows - 1, Math.max(0, Math.floor(y / cellH)));
    const idx = gy * cols + gx;
    const biome = refBiomeOf[idx];
    if (biome === 'deepwater' || biome === 'shallowwater') return null;
    return { x, y, gx, gy, idx, biome, zone: zoneAtCell(idx) };
  }
  // Point-feature wild-zone landmarks (Ley Line Nexus, Astral Scar, Giant's
  // Garden, Sunken Ruins) are drawn (see the wildZonesOn-gated loop in
  // generate()) but were never click-targets -- clicking one fell through to
  // hitTestLand's generic "empty terrain" path, which had no idea a specific
  // named landmark was right there, so it opened an unrelated detail map
  // with its own randomly-placed, differently-named landmark. Same
  // padding-for-easier-hitting pattern as hitTestSettlement; only live when
  // the icons themselves are (wildZonesOn), same as their own draw gate.
  function hitTestLandmark(evt) {
    if (!worldCache || !container.querySelector('#ow-wildzones').checked) return null;
    const { x, y } = canvasToInternal(evt);
    let best = null, bestDist = Infinity;
    (worldCache.landmarks || []).forEach((lm) => {
      const d = Math.hypot(lm.x - x, lm.y - y);
      if (d <= 14 && d < bestDist) { best = lm; bestDist = d; }
    });
    return best;
  }
  // Neighborhood average (not the single clicked cell) so a detail map's
  // bias reflects the general character of the area rather than one noise
  // sample -- a click right at a biome's ragged edge would otherwise anchor
  // the detail map to an atypical single cell.
  function sampleLocalCharacter(world, gx, gy, radius) {
    const { cols, rows, heights, mOf } = world;
    let hSum = 0, mSum = 0, n = 0;
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const cx = gx + dx, cy = gy + dy;
        if (cx < 0 || cx >= cols || cy < 0 || cy >= rows) continue;
        const idx = cy * cols + cx;
        hSum += heights[idx]; mSum += mOf[idx]; n++;
      }
    }
    return { avgHeight: n ? hSum / n : 0.5, avgMoisture: n ? mSum / n : 0.5 };
  }
  // A single averaged number (sampleLocalCharacter above) told the detail
  // map "roughly how high/wet it is here," but nothing about the actual
  // SHAPE of the ground -- which way the coast curves, where the real
  // slope goes. Confirmed directly by account-owner feedback: two clicks
  // with similar average elevation produced similar-statistics-but-
  // unrelated terrain, not an actual zoomed-in view of the clicked spot.
  // This samples a small grid of REAL heights from a window centered on
  // the click (quantized to one byte each -- plenty of precision for a
  // shape guide, not for exact replay) so map-detail.js can use the
  // parent's own real local geography as the dominant shape, with its own
  // fresh noise demoted to an added-detail perturbation on top. Clamping
  // cx/cy at the map edge just repeats the edge value outward rather than
  // wrapping or crashing -- acceptable degenerate behavior for a click
  // near the coastline/map boundary.
  // 4:3 to match the detail canvas's own aspect ratio. ZOOM_FACTOR=3 means
  // the detail canvas shows a window 1/3 the width/height of the overworld
  // canvas, in overworld pixels -- i.e. it's a 3x zoom-in, not a full-map
  // shrink. Resolution confirmed against real output, not assumed: at
  // Standard tier the window spans roughly 77x58 real parent cells, so the
  // original 32x24 grid was sampling barely one point per ~2.4 real cells
  // -- coarse enough that a real, jagged coastline curve washed out into a
  // smoothed bilinear approximation, and the still-present fine noise on
  // the detail side filled the gap with invented (not real) wiggle. 64x48
  // brings sampling down to roughly one point per real cell, so the
  // coastline the detail map draws is the actual one, not an interpolation
  // of it.
  const DETAIL_GUIDE_W = 64;
  const DETAIL_GUIDE_H = 48;
  const DETAIL_ZOOM_FACTOR = 3;
  // A settlement's terrain backdrop deliberately shows a WIDER real-world
  // window than an ordinary detail-map click frames -- roads/fields/hills
  // beyond the town's own walls should read as surrounding context rather
  // than being consumed almost entirely by the town's own footprint (see
  // buildSettlementMapUrl below).
  const SETTLEMENT_ZOOM_FACTOR = 2;
  function sampleHeightGuide(world, gx, gy, gridW, gridH, windowCellsX, windowCellsY) {
    const { cols, rows, heights } = world;
    const bytes = new Uint8Array(gridW * gridH);
    // Bilinear (not nearest-cell) so a guide sample landing between two real
    // cells doesn't just snap to whichever one is closer -- consistent with
    // how sampleGuide interpolates this same grid back out on the detail
    // side, so no extra staircasing is introduced on either end of the trip.
    function sampleRealHeight(cx, cy) {
      const x0 = Math.max(0, Math.min(cols - 1, Math.floor(cx)));
      const y0 = Math.max(0, Math.min(rows - 1, Math.floor(cy)));
      const x1 = Math.min(cols - 1, x0 + 1), y1 = Math.min(rows - 1, y0 + 1);
      const tx = Math.max(0, Math.min(1, cx - x0)), ty = Math.max(0, Math.min(1, cy - y0));
      const g = (x, y) => heights[y * cols + x];
      const top = g(x0, y0) * (1 - tx) + g(x1, y0) * tx;
      const bot = g(x0, y1) * (1 - tx) + g(x1, y1) * tx;
      return top * (1 - ty) + bot * ty;
    }
    for (let sy = 0; sy < gridH; sy++) {
      const fy = (sy + 0.5) / gridH - 0.5; // -0.5..0.5 across the window
      for (let sx = 0; sx < gridW; sx++) {
        const fx = (sx + 0.5) / gridW - 0.5;
        const cx = Math.max(0, Math.min(cols - 1, gx + fx * windowCellsX));
        const cy = Math.max(0, Math.min(rows - 1, gy + fy * windowCellsY));
        bytes[sy * gridW + sx] = Math.max(0, Math.min(255, Math.round(sampleRealHeight(cx, cy) * 255)));
      }
    }
    return bytes;
  }
  // Shared by the empty-terrain click, the landmark click, and the print-
  // tile export below -- pulled out so the guide-sampling/URL-building
  // logic (the part that took several rounds to get right: real geography,
  // not just averaged statistics) exists in exactly one place rather than
  // several copies that could silently drift apart. Returns a query-string
  // FRAGMENT (leading `&`), not a full URL, since every caller still needs
  // to add its own route/seed/biome/zone/extra params around it.
  function buildGuideParams(x, y, gx, gy, windowCellsX, windowCellsY) {
    const { avgHeight, avgMoisture } = sampleLocalCharacter(worldCache, gx, gy, 4);
    const seaLevel = parseInt(container.querySelector('#ow-sea').value, 10) / 100;
    const guideW = DETAIL_GUIDE_W, guideH = DETAIL_GUIDE_H;
    const guideBytes = sampleHeightGuide(worldCache, gx, gy, guideW, guideH, windowCellsX, windowCellsY);
    const guideB64 = btoa(String.fromCharCode(...guideBytes));
    return `&x=${Math.round(x)}&y=${Math.round(y)}&h=${avgHeight.toFixed(3)}&m=${avgMoisture.toFixed(3)}&sea=${seaLevel}` +
      `&guide=${encodeURIComponent(guideB64)}&gw=${guideW}&gh=${guideH}&zoom=${DETAIL_ZOOM_FACTOR}`;
  }
  // A click-relative window sized to 1/3 of the parent canvas -- the
  // original click-to-zoom sizing, kept as the default for both ordinary
  // terrain clicks and landmark clicks. The print-tile exporter below
  // passes its own tile-footprint-sized window into buildGuideParams
  // directly instead of using this helper.
  function clickWindowCells() {
    return {
      windowCellsX: (canvas.width / DETAIL_ZOOM_FACTOR) / worldCache.cellW,
      windowCellsY: (canvas.height / DETAIL_ZOOM_FACTOR) / worldCache.cellH,
    };
  }
  function buildDetailMapUrl(x, y, gx, gy, biome, zone, extraParams) {
    const { windowCellsX, windowCellsY } = clickWindowCells();
    return `#/map/detail?seed=${currentSeed}&biome=${biome}` +
      buildGuideParams(x, y, gx, gy, windowCellsX, windowCellsY) +
      (zone ? `&zone=${zone.key}` : '') +
      (extraParams || '');
  }
  // Landmark click target: routes to the dedicated structured-site view
  // (views/map-landmark.js) instead of the generic terrain-zoom path --
  // settlements already get their own purpose-built generator rather than
  // routing through generic terrain, and landmarks need the same
  // treatment (the "reads as a zoomed screenshot with a label" complaint
  // this replaces).
  function buildLandmarkMapUrl(x, y, gx, gy, biome, zone, poiKey, poiLabel, poiName) {
    const { windowCellsX, windowCellsY } = clickWindowCells();
    return `#/map/landmark?seed=${currentSeed}&biome=${biome}` +
      buildGuideParams(x, y, gx, gy, windowCellsX, windowCellsY) +
      (zone ? `&zone=${zone.key}` : '') +
      `&poi=${poiKey}&poiLabel=${encodeURIComponent(poiLabel)}&poiName=${encodeURIComponent(poiName)}`;
  }
  // Settlement click target: threads real backdrop-terrain params through
  // to views/map-settlement.js's own renderTerrainPatch call, the same way
  // buildLandmarkMapUrl already does for landmarks -- addresses "no
  // surrounding context." Uses a WIDER window (SETTLEMENT_ZOOM_FACTOR, from
  // views/map-settlement.js) than an ordinary detail-map click, so roads/
  // fields/hills beyond the town's own walls are visible in the backdrop
  // rather than being consumed almost entirely by the town's own footprint.
  // `coastal` is derived from this same closure's own already-computed
  // regionCategory/regionOf (the same value backing the
  // coastalSettlementFraction stat) -- the settlement generator itself has
  // no notion of "is this town coastal," so it has to be threaded in.
  // Shared by the live click handler below and the "Export all maps" batch
  // loop so both stay in sync.
  function buildSettlementMapUrl(s, i) {
    const { cols, rows, cellW, cellH, regionOf, regionCategory } = worldCache;
    const gx = Math.min(cols - 1, Math.max(0, Math.floor(s.x / cellW)));
    const gy = Math.min(rows - 1, Math.max(0, Math.floor(s.y / cellH)));
    const windowCellsX = (canvas.width / SETTLEMENT_ZOOM_FACTOR) / cellW;
    const windowCellsY = (canvas.height / SETTLEMENT_ZOOM_FACTOR) / cellH;
    const coastal = regionCategory[regionOf[s.index]] === 'coastal' ? 1 : 0;
    return `#/map/settlement?seed=${currentSeed}&idx=${i}&name=${encodeURIComponent(s.name)}&tier=${s.tier}` +
      buildGuideParams(s.x, s.y, gx, gy, windowCellsX, windowCellsY) +
      `&coastal=${coastal}`;
  }
  canvas.addEventListener('mousemove', (evt) => {
    canvas.style.cursor = (hitTestSettlement(evt) || hitTestLandmark(evt) || hitTestLand(evt)) ? 'pointer' : 'default';
  });
  canvas.addEventListener('click', (evt) => {
    const hit = hitTestSettlement(evt);
    const actionEl = container.querySelector('#ow-settlement-action');
    actionEl.innerHTML = '';
    if (hit) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = `Generate town map for ${hit.settlement.name} →`;
      btn.addEventListener('click', () => {
        location.hash = buildSettlementMapUrl(hit.settlement, hit.idx);
      });
      actionEl.appendChild(btn);
      return;
    }
    // Point-feature wild-zone landmark click: unlike an empty-terrain click,
    // this spot has a specific, already-named feature on it (e.g. "Ley Line
    // Nexus of Kharzhall") -- routes to the dedicated structured-site view
    // (views/map-landmark.js), not the generic terrain-zoom path, carrying
    // the landmark's identity as `poi`/`poiLabel`/`poiName`.
    const landmarkHit = hitTestLandmark(evt);
    if (landmarkHit) {
      const { cols, rows, cellW, cellH, refBiomeOf } = worldCache;
      const gx = Math.min(cols - 1, Math.max(0, Math.floor(landmarkHit.x / cellW)));
      const gy = Math.min(rows - 1, Math.max(0, Math.floor(landmarkHit.y / cellH)));
      const idx = gy * cols + gx;
      const biome = refBiomeOf[idx];
      const zone = zoneAtCell(idx);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = `Generate site map for ${landmarkHit.name} →`;
      btn.addEventListener('click', () => {
        location.hash = buildLandmarkMapUrl(landmarkHit.x, landmarkHit.y, gx, gy, biome, zone, landmarkHit.key, landmarkHit.label, landmarkHit.name);
      });
      actionEl.appendChild(btn);
      return;
    }
    // Empty-terrain click: offer a zoomed-in detail map of this spot. Only
    // 4 scalars cross the URL (biome for the button label; h/m/sea as the
    // actual thematic anchor) -- everything else (the detail map's actual
    // terrain shape, erosion, rivers, its landmark) is freshly generated by
    // map-detail.js, biased toward those numbers, the same way
    // map-settlement.js regenerates a wholly new building layout rather
    // than reusing this map's own mesh geometry.
    const landHit = hitTestLand(evt);
    if (!landHit) return;
    const btn = document.createElement('button');
    btn.type = 'button';
    const zoneOn = container.querySelector('#ow-wildzones').checked && landHit.zone;
    btn.textContent = `Generate detail map here (${zoneOn ? landHit.zone.label : landHit.biome}) →`;
    btn.addEventListener('click', () => {
      location.hash = buildDetailMapUrl(landHit.x, landHit.y, landHit.gx, landHit.gy, landHit.biome, zoneOn ? landHit.zone : null, '');
    });
    actionEl.appendChild(btn);
  });

  // Unlike every other control here (which only takes effect on the next
  // Regenerate/theme change), the bias sliders redraw live on every drag
  // tick -- instant feedback is the actual point of a "sculpt this
  // terrain" control, and it's safe to do live because biomeAt() is a
  // cheap reclassification of already-computed height/moisture, not a
  // re-roll of the mesh/heightmap/settlements. A full generate() (measured,
  // watercolor-wash work included) costs roughly 150ms at the default 400
  // cells and 600-750ms at the 1000-cell ceiling -- the latter is too slow
  // for a fluid drag regardless of the wash (the wash itself only accounts
  // for ~100-150ms of that; the rest is pre-existing mesh/settlement/road
  // cost at that cell count, unrelated to this pass). `generate(true)`
  // (fast mode) skips the wash and rosette/tree icon passes for in-drag
  // ticks; the 'change' listeners below run one full-quality redraw once
  // the slider is released. A slider can also fire input events faster
  // than even the fast path redraws, so naive per-event redraw would queue
  // up a growing backlog. Coalescing every burst of input events down to
  // one generate() call on the next tick (always reading the slider's
  // *current* value when it fires, not a stale snapshot from whichever
  // event triggered it) keeps the drag responsive at any cell count
  // instead of falling behind. setTimeout(0) rather than
  // requestAnimationFrame deliberately -- this only needs "run once after
  // the current synchronous burst settles", not paint-cycle
  // synchronization, and rAF can be throttled independently of whether the
  // user is actively dragging.
  let liveRegenTimeoutId = null;
  function scheduleLiveRegen() {
    if (liveRegenTimeoutId !== null) return;
    liveRegenTimeoutId = setTimeout(() => {
      liveRegenTimeoutId = null;
      generate(true);
    }, 0);
  }
  // 'change' fires once when the slider is released (unlike 'input', which
  // fires continuously while dragging), synchronously right after the
  // final 'input' event -- used to run one full-quality redraw (wash +
  // rosette/tree icons) once dragging settles. Must cancel any timeout
  // still pending from that final 'input' tick first: setTimeout(0)
  // callbacks run after the current synchronous handler (this one)
  // finishes, so an uncancelled fast-mode redraw would fire right after
  // this full-quality one and silently revert the map back to fast mode.
  function finishLiveRegen() {
    if (liveRegenTimeoutId !== null) {
      clearTimeout(liveRegenTimeoutId);
      liveRegenTimeoutId = null;
    }
    generate(false);
  }

  // Map scale presets: bundle canvas size + cell-count range + settlement
  // max into one choice rather than requiring the raw sliders to be
  // hand-tuned into a sane combination -- still adjustable afterward via
  // those same sliders, just with a sensible starting point one click away.
  // "Standard" is today's exact numbers (unchanged); "Continent" is gated
  // behind buildWorld's own CONTINENT_CELL_THRESHOLD, so choosing it is
  // what actually reaches the multi-range/regional-moisture/erosion-taper
  // code above -- below that cell count none of it is reachable.
  const OW_SCALE_PRESETS = {
    standard: { width: 800, height: 600, cellsMin: 10000, cellsMax: 70000, cellsValue: 40000, settleMax: 20, settleValue: 6 },
    continent: { width: 1600, height: 1200, cellsMin: 80000, cellsMax: 250000, cellsValue: 150000, settleMax: 35, settleValue: 20 },
  };
  function applyScalePreset(name) {
    const p = OW_SCALE_PRESETS[name] || OW_SCALE_PRESETS.standard;
    canvas.width = p.width;
    canvas.height = p.height;
    const cellsEl = container.querySelector('#ow-cells');
    cellsEl.min = p.cellsMin; cellsEl.max = p.cellsMax; cellsEl.value = p.cellsValue;
    const settleEl = container.querySelector('#ow-settle');
    settleEl.max = p.settleMax; settleEl.value = p.settleValue;
  }

  generate(false);
  container.querySelector('#ow-regen').addEventListener('click', () => generate(false));
  container.querySelector('#ow-theme').addEventListener('change', () => generate(false));
  container.querySelector('#ow-scale').addEventListener('change', (evt) => {
    applyScalePreset(evt.target.value);
    generate(false);
  });
  container.querySelector('#ow-forest-bias').addEventListener('input', scheduleLiveRegen);
  container.querySelector('#ow-forest-bias').addEventListener('change', finishLiveRegen);
  container.querySelector('#ow-rugged-bias').addEventListener('input', scheduleLiveRegen);
  container.querySelector('#ow-rugged-bias').addEventListener('change', finishLiveRegen);
  wireMapExportSave(container, canvas, 'ow', (offCtx) => {
    const prevCtx = ctx;
    ctx = offCtx;
    generate(false);
    ctx = prevCtx;
  });

  // "Export all maps": every POI on the current map (every settlement's town
  // map, every wild-zone landmark's detail map) plus the overworld itself,
  // bundled into one downloadable zip -- rendered by calling the SAME
  // renderSettlementMap/renderDetailMap functions app.js's router calls, just
  // against a detached, never-inserted container with synthetic params
  // matching exactly what a real click builds (see the settlement/landmark
  // click handlers above). Reuses the existing generators as-is rather than
  // a second, parallel rendering path that could drift from what clicking
  // through actually produces. Canvas drawing doesn't need layout/attachment
  // to the live DOM, so the container is never appended anywhere.
  function sanitizeZipEntryName(name) {
    return (name || 'unnamed').replace(/[^a-zA-Z0-9 _-]/g, '').trim() || 'unnamed';
  }
  function canvasToPngBytes(sourceCanvas) {
    return new Promise((resolve, reject) => {
      sourceCanvas.toBlob((blob) => {
        if (!blob) { reject(new Error('canvas export failed')); return; }
        blob.arrayBuffer().then((buf) => resolve(new Uint8Array(buf)));
      }, 'image/png');
    });
  }
  // A yield between each POI's render -- generate() for a detail/settlement
  // map is synchronous and can take real time (erosion, contour extraction);
  // without ceding a tick, the whole batch runs as one uninterrupted block
  // and the status text below never actually paints until it's all done.
  function yieldToPaint() {
    return new Promise((resolve) => setTimeout(resolve, 0));
  }
  container.querySelector('#ow-export-all').addEventListener('click', async () => {
    const statusEl = container.querySelector('#ow-export-all-status');
    const exportBtn = container.querySelector('#ow-export-all');
    if (!worldCache) { statusEl.textContent = 'Generate a map first.'; return; }
    exportBtn.disabled = true;
    try {
      const files = [];
      statusEl.textContent = 'Rendering overworld map...';
      await yieldToPaint();
      files.push({ name: 'overworld.png', data: await canvasToPngBytes(canvas) });

      const settlements = currentSettlements || [];
      for (let i = 0; i < settlements.length; i++) {
        const s = settlements[i];
        statusEl.textContent = `Rendering settlement ${i + 1}/${settlements.length}: ${s.name}...`;
        await yieldToPaint();
        const url = buildSettlementMapUrl(s, i);
        const params = new URLSearchParams(url.split('?')[1]);
        const tempContainer = document.createElement('div');
        renderSettlementMap(tempContainer, params);
        const data = await canvasToPngBytes(tempContainer.querySelector('canvas'));
        files.push({ name: `settlements/${sanitizeZipEntryName(s.name)}.png`, data });
      }

      // worldCache.landmarks is populated regardless of the Wild zones
      // checkbox (that gate is PAINT-time only, same reason the checkbox
      // doesn't force a different cached world) -- gated here too, matching
      // hitTestLandmark's own gate, so exporting doesn't surface landmarks
      // the user can't currently see or click on this map.
      const landmarks = container.querySelector('#ow-wildzones').checked ? (worldCache.landmarks || []) : [];
      for (let i = 0; i < landmarks.length; i++) {
        const lm = landmarks[i];
        statusEl.textContent = `Rendering landmark ${i + 1}/${landmarks.length}: ${lm.name}...`;
        await yieldToPaint();
        const { cols, rows, cellW, cellH, refBiomeOf } = worldCache;
        const gx = Math.min(cols - 1, Math.max(0, Math.floor(lm.x / cellW)));
        const gy = Math.min(rows - 1, Math.max(0, Math.floor(lm.y / cellH)));
        const idx = gy * cols + gx;
        const url = buildLandmarkMapUrl(lm.x, lm.y, gx, gy, refBiomeOf[idx], zoneAtCell(idx), lm.key, lm.label, lm.name);
        const params = new URLSearchParams(url.split('?')[1]);
        const tempContainer = document.createElement('div');
        renderLandmarkMap(tempContainer, params);
        const data = await canvasToPngBytes(tempContainer.querySelector('canvas'));
        files.push({ name: `landmarks/${sanitizeZipEntryName(lm.name)}.png`, data });
      }

      statusEl.textContent = 'Building zip...';
      await yieldToPaint();
      const blob = createZipBlob(files);
      const a = document.createElement('a');
      a.download = `campaign-hub-maps-seed-${currentSeed}.zip`;
      a.href = URL.createObjectURL(blob);
      a.click();
      URL.revokeObjectURL(a.href);
      statusEl.textContent = `Done -- ${files.length} maps exported.`;
    } catch (err) {
      statusEl.textContent = `Export failed: ${err && err.message ? err.message : 'unknown error'}.`;
    } finally {
      exportBtn.disabled = false;
    }
  });

  // Grid-aligned print tiles: divides the CURRENT canvas into tileCols x
  // tileRows equal rectangles and renders each one as its own detail-map-
  // style sheet at the SAME scale/orientation as its position -- printing
  // every sheet and arranging them by row/col reconstructs the continent
  // at higher effective resolution than the single overview PNG alone.
  // Zero overlap by construction (tileW/tileCols exactly partitions the
  // canvas); tileMode (`&tile=1`, see map-detail.js) skips the grain/
  // compass/border decoration so adjacent sheets butt together seamlessly.
  function buildTileMapUrl(tileCol, tileRow, tileCols, tileRows) {
    const tileW = canvas.width / tileCols, tileH = canvas.height / tileRows;
    const cx = (tileCol + 0.5) * tileW, cy = (tileRow + 0.5) * tileH;
    const { cols, rows, cellW, cellH, refBiomeOf } = worldCache;
    const gx = Math.min(cols - 1, Math.max(0, Math.floor(cx / cellW)));
    const gy = Math.min(rows - 1, Math.max(0, Math.floor(cy / cellH)));
    const idx = gy * cols + gx;
    const windowCellsX = tileW / cellW, windowCellsY = tileH / cellH;
    const zone = zoneAtCell(idx);
    return `#/map/detail?seed=${currentSeed}&biome=${refBiomeOf[idx]}` +
      buildGuideParams(cx, cy, gx, gy, windowCellsX, windowCellsY) +
      (zone ? `&zone=${zone.key}` : '') +
      `&tile=1`;
  }
  container.querySelector('#ow-export-tiles').addEventListener('click', async () => {
    const statusEl = container.querySelector('#ow-export-tiles-status');
    const exportBtn = container.querySelector('#ow-export-tiles');
    if (!worldCache) { statusEl.textContent = 'Generate a map first.'; return; }
    const tileCols = Math.max(1, parseInt(container.querySelector('#ow-tile-cols').value, 10) || 1);
    const tileRows = Math.max(1, parseInt(container.querySelector('#ow-tile-rows').value, 10) || 1);
    exportBtn.disabled = true;
    try {
      const files = [];
      statusEl.textContent = 'Rendering tile index...';
      await yieldToPaint();
      // A labeled key is required, not optional -- without it there's no
      // way to know which printed sheet goes where. Redrawn fresh onto its
      // own offscreen canvas (same ctx-swap idiom wireMapExportSave uses)
      // with the grid FORCED on, regardless of whether the live preview
      // checkbox happens to be checked right now.
      const indexCanvas = document.createElement('canvas');
      indexCanvas.width = canvas.width;
      indexCanvas.height = canvas.height;
      const indexCtx = indexCanvas.getContext('2d');
      const prevCtx = ctx;
      ctx = indexCtx;
      generate(false);
      ctx = prevCtx;
      const theme = MAP_THEMES[container.querySelector('#ow-theme').value] || MAP_THEMES[MAP_THEME_DEFAULT];
      drawTileGridOverlay(indexCtx, indexCanvas, theme.overworld, tileCols, tileRows);
      files.push({ name: 'tile-index.png', data: await canvasToPngBytes(indexCanvas) });

      const total = tileCols * tileRows;
      let done = 0;
      for (let r = 0; r < tileRows; r++) {
        for (let c = 0; c < tileCols; c++) {
          done++;
          statusEl.textContent = `Rendering tile ${done}/${total} (row ${r + 1}, col ${c + 1})...`;
          await yieldToPaint();
          const url = buildTileMapUrl(c, r, tileCols, tileRows);
          const params = new URLSearchParams(url.split('?')[1]);
          const tempContainer = document.createElement('div');
          renderDetailMap(tempContainer, params);
          const data = await canvasToPngBytes(tempContainer.querySelector('canvas'));
          files.push({ name: `tiles/row${r + 1}-col${c + 1}.png`, data });
        }
      }

      statusEl.textContent = 'Building zip...';
      await yieldToPaint();
      const blob = createZipBlob(files);
      const a = document.createElement('a');
      a.download = `campaign-hub-tiles-seed-${currentSeed}.zip`;
      a.href = URL.createObjectURL(blob);
      a.click();
      URL.revokeObjectURL(a.href);
      statusEl.textContent = `Done -- ${total} tiles + index exported.`;
    } catch (err) {
      statusEl.textContent = `Export failed: ${err && err.message ? err.message : 'unknown error'}.`;
    } finally {
      exportBtn.disabled = false;
    }
  });
}
