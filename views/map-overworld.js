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
  if (moist > forestT) return 'forest';
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

// Relative cost of routing a road through each biome -- plains/beach are
// cheap, forest and hills cost more, mountains and snow cost the most.
// Water isn't listed because computeRoadPath excludes water cells from the
// routable graph entirely (roads in this world don't cross open water).
const OW_TERRAIN_ROAD_COST = { beach: 1.2, plains: 1, forest: 1.3, hills: 2, mountains: 4, snow: 2.5 };

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
function drawMapLegend(ctx, canvas, palette) {
  const rows = [
    { type: 'swatch', color: palette.biomes.deepwater, label: 'Deep water' },
    { type: 'swatch', color: palette.biomes.shallowwater, label: 'Shallow water' },
    { type: 'swatch', color: palette.biomes.beach, label: 'Beach' },
    { type: 'swatch', color: palette.biomes.plains, label: 'Plains' },
    { type: 'swatch', color: palette.biomes.forest, label: 'Forest' },
    { type: 'swatch', color: palette.biomes.hills, label: 'Hills' },
    { type: 'swatch', color: palette.biomes.mountains, label: 'Mountains' },
    { type: 'swatch', color: palette.biomes.snow, label: 'Snow' },
    { type: 'icon', tier: 'village', label: 'Village' },
    { type: 'icon', tier: 'town', label: 'Town' },
    { type: 'icon', tier: 'city', label: 'City' },
    { type: 'line', color: palette.river, label: 'River' },
    { type: 'line', color: palette.coastline, label: 'Coastline' },
    { type: 'line', color: palette.road, label: 'Road' },
  ];
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
        <label>Cells <input id="ow-cells" type="number" value="40000" min="10000" max="70000" step="5000"></label>
        <label>Octaves <input id="ow-oct" type="number" value="4" min="1" max="6"></label>
        <label>Sea level <input id="ow-sea" type="range" min="0" max="100" value="42"></label>
        <label>Vegetation <input id="ow-forest-bias" type="range" min="-40" max="40" value="0"></label>
        <label>Ruggedness <input id="ow-rugged-bias" type="range" min="-20" max="20" value="0"></label>
        <label><input id="ow-island" type="checkbox" checked> Island mode</label>
        <label><input id="ow-rivers" type="checkbox" checked> Rivers</label>
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
  let worldCache = null;
  function buildWorld(seed, cellCount, octaves, island, seaLevel, riversOn, settleCount) {
    const key = [seed, cellCount, octaves, island, seaLevel, riversOn, settleCount].join('|');
    if (worldCache && worldCache.key === key) return worldCache;

    const meshRng = mulberry32(seed + 77777);
    const mesh = buildTerrainGrid(meshRng, canvas.width, canvas.height, cellCount);
    const { cols, rows, cellW, cellH } = mesh;

    // Height = isotropic base terrain (rolling variation, unchanged) +
    // a RIDGED mountain layer, sampled through a rotated/stretched
    // coordinate frame so it reads as one range with a real long axis
    // instead of isotropic noise thresholded into round, disconnected
    // blobs -- confirmed as the actual complaint (not a guess) via
    // AskUserQuestion after the account owner rejected the first grid+
    // erosion pass outright: "landmass is a blob", "mountains are round
    // dots, not ranges", "rivers are too sparse/short". Island-mode falloff
    // is no longer a plain circle: the cutoff radius itself varies by
    // angle (a handful of random sine harmonics, much lower frequency than
    // either noise layer), so the coastline's GROSS shape has real
    // large-scale bays/headlands instead of erosion just adding fine
    // wiggle to a mathematically perfect circle. Both new noise layers
    // live in lib/noise.js; validated in a standalone prototype across 8
    // seeds (elongated/irregular landmasses, ridge-following highland
    // wash, 9-23 rivers per map vs. the single-digit count before) before
    // being wired in here.
    const heightRng = mulberry32(seed);
    const heightSample = makeFbmSampler(heightRng, octaves);
    const ridgeRng = mulberry32(seed + 70707);
    const ridgeAngle = ridgeRng() * Math.PI;
    const baseRidged = makeRidgedFbmSampler(ridgeRng, Math.min(5, octaves + 1));
    const ridgedSample = makeAnisotropicSampler(baseRidged, ridgeAngle, 1.0, 2.8);
    const islandRng = mulberry32(seed + 80808);
    const radiusWobble = makeRadialWobbleSampler(islandRng, 6);
    const heights = new Float64Array(mesh.cells.length);
    const cx = canvas.width / 2, cy = canvas.height / 2, maxD = Math.hypot(cx, cy);
    mesh.cells.forEach((cell, i) => {
      const u = cell.x / canvas.width, v = cell.y / canvas.height;
      let h = heightSample(u, v) * 0.5 + ridgedSample(u, v) * 0.75;
      if (island) {
        const dx = cell.x - cx, dy = cell.y - cy;
        const theta = Math.atan2(dy, dx);
        const dist = Math.hypot(dx, dy) / maxD;
        const effectiveMaxDist = 0.72 + radiusWobble(theta) * 0.32;
        const t = dist / effectiveMaxDist;
        h *= Math.max(0, 1 - t * t * 1.3);
      }
      heights[i] = h;
    });

    // Erosion pipeline (lib/terrain-grid.js), matching the Step 0 prototype
    // exactly: pit-fill before erosion so hydrology below doesn't inherit
    // the raw noise field's own tiny pits, hydraulic + thermal erosion for
    // the actual organic shaping, then a second pit-fill pass since erosion
    // itself introduces new small single-cell pits.
    const erosionRng = mulberry32(seed + 50505);
    fillPits(heights, cols, rows, seaLevel);
    applyHydraulicErosion(heights, cols, rows, erosionRng, {});
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
    }

    // Moisture (river-adjacency bump already folded in) and refBiome are
    // both bias-independent -- forestBias/ruggedBias only affect the LIVE
    // `biome` field, computed fresh per render in generate() itself.
    const moistureSample = makeFbmSampler(mulberry32(seed + 99991), Math.max(1, octaves - 1));
    const mOf = new Float64Array(mesh.cells.length);
    const refBiomeOf = new Array(mesh.cells.length);
    mesh.cells.forEach((cell, i) => {
      let m = moistureSample(cell.x / canvas.width, cell.y / canvas.height);
      m = Math.min(1, m + nearRiver[i] * 0.3);
      mOf[i] = m;
      refBiomeOf[i] = biomeAt(heights[i], m, seaLevel, 0, 0);
    });

    // Resolve each naming region to a phoneme category by tallying its
    // cells' refBiomes and taking the majority.
    const regionBiomeTally = [];
    for (let r = 0; r < regionCount; r++) regionBiomeTally.push({});
    for (let i = 0; i < mesh.cells.length; i++) {
      const tally = regionBiomeTally[regionOf[i]];
      const category = BIOME_TO_NAME_CATEGORY[refBiomeOf[i]] || 'plains';
      tally[category] = (tally[category] || 0) + 1;
    }
    const regionCategory = regionBiomeTally.map((tally) => {
      let best = 'plains', bestCount = -1;
      for (const category in tally) { if (tally[category] > bestCount) { bestCount = tally[category]; best = category; } }
      return best;
    });

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
    };
    return worldCache;
  }

  // Builds one path from every closed loop in `loops` -- shared by the two
  // helpers below, which differ only in what they do with that path.
  function pathFromLoops(loops) {
    ctx.beginPath();
    for (const loop of loops) {
      ctx.moveTo(loop[0].x, loop[0].y);
      for (let i = 1; i < loop.length; i++) ctx.lineTo(loop[i].x, loop[i].y);
      ctx.closePath();
    }
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

    const world = buildWorld(seed, cellCount, octaves, island, seaLevel, riversOn, settleCount);
    const {
      mesh, heights, cols, rows, cellW, cellH,
      mOf, refBiomeOf, flow, downhill, isLake, riverThreshold, nearRiver,
      regionOf, regionCategory, settlements, roadPaths,
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
      extractFillableRegions(cols, rows, cellW, cellH, heightAt, seaLevel - 0.08, canvas.width, canvas.height, minLoopArea),
      palette.biomes.shallowwater
    );
    const beachLoops = extractFillableRegions(cols, rows, cellW, cellH, heightAt, seaLevel, canvas.width, canvas.height, minLoopArea);
    fillLoopsEvenOdd(beachLoops, palette.biomes.beach);
    const landLoops = extractFillableRegions(cols, rows, cellW, cellH, heightAt, seaLevel + 0.03, canvas.width, canvas.height, minLoopArea);
    fillLoopsEvenOdd(landLoops, palette.biomes.plains);

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
        if (biome === 'hills' || biome === 'mountains' || biome === 'forest') continue; // wash+icon pass below, gated by !fast
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
          } else if (biome === 'forest') {
            paintBiomeTexture(ctx, biome, px, py, spacing, spacing, textureRng, palette.ink);
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

    paintParchmentGrain(ctx, canvas, grainRng, palette.grain);

    if (legendOn) drawMapLegend(ctx, canvas, palette);

    drawCompassRose(ctx, canvas.width - 50, 50, 28, palette.coastline);
    drawMapVignetteAndBorder(ctx, canvas, palette.coastline, borderRng);

    // Suggested campaign theme: a heuristic read of this specific map's own
    // statistics (biome mix, settlement tiers, river count, island-ness),
    // not anything the map's rendering needs -- computed last, purely from
    // data already on hand.
    const landBiomeCounts = { plains: 0, forest: 0, hills: 0, mountains: 0, snow: 0 };
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
  canvas.addEventListener('mousemove', (evt) => {
    canvas.style.cursor = hitTestSettlement(evt) ? 'pointer' : 'default';
  });
  canvas.addEventListener('click', (evt) => {
    const hit = hitTestSettlement(evt);
    const actionEl = container.querySelector('#ow-settlement-action');
    actionEl.innerHTML = '';
    if (!hit) return;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = `Generate town map for ${hit.settlement.name} →`;
    btn.addEventListener('click', () => {
      const url = `#/map/settlement?seed=${currentSeed}&idx=${hit.idx}&name=${encodeURIComponent(hit.settlement.name)}&tier=${hit.settlement.tier}`;
      location.hash = url;
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

  generate(false);
  container.querySelector('#ow-regen').addEventListener('click', () => generate(false));
  container.querySelector('#ow-theme').addEventListener('change', () => generate(false));
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
}
