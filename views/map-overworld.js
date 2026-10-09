// Climate-band thresholds for the temperature axis below -- not slider-
// biased (there's no live control for climate, only Vegetation/Ruggedness),
// so these stay plain module constants rather than per-call parameters.
// tOf (0 = coldest, 1 = hottest) comes from buildWorld's per-seed randomized
// equator-line field; biomeAt just consumes it as a third independent axis.
const OW_COLD_TEMP_T = 0.32;
const OW_HOT_TEMP_T = 0.68;
// Swamp/wetland override: a low-elevation, very-high-moisture pocket,
// independent of climate band (real wetlands range from tropical mangrove
// swamp to temperate marsh to sub-arctic bog alike). Narrower than the
// hills cutoff below so it only ever claims low ground near the coast/
// floodplain, never competing with taiga/jungle/forest's own much larger
// footprint.
const OW_SWAMP_HEIGHT_OFFSET = 0.06;
const OW_SWAMP_MOIST_T = 0.66;

// forestBias/ruggedBias let the live Vegetation/Ruggedness sliders (Phase 9)
// shift the moisture and height thresholds without touching the height,
// moisture, or temperature fields themselves -- the terrain's actual shape
// never changes, only where the biome lines fall on it. Thresholds are
// floored relative to each other (and to seaLevel) rather than shifted
// freely, so a slider dragged to its extreme can never invert or collapse
// the ordering into a degenerate all-one-biome map.
//
// Three independent axes (height, moisture, temperature) drive
// classification, Whittaker-diagram style, rather than the old height+
// moisture-only scheme: height still gates water/beach/hills/mountains/
// snow exactly as before (temperature does NOT reshape those bands --
// the render pipeline extracts hills/mountains/snow as a single
// marching-squares pass over the raw height field, so keeping their
// thresholds purely height-driven keeps that pass, and every other
// hillsT/mountainsT/snowT copy in this file, correct with zero further
// changes). Below the hills line, the SAME moisture thresholds
// (wetT/aridT/veryAridT) apply in every climate band, just resolving to a
// different named biome per band -- cold+wet is taiga where temperate+wet
// is forest is hot+wet is jungle, etc. -- so forestBias still means exactly
// what it always meant ("more/less vegetation") everywhere on the map, not
// just in one climate.
function biomeAt(h, moist, temp, seaLevel, forestBias, ruggedBias) {
  forestBias = forestBias || 0;
  ruggedBias = ruggedBias || 0;
  // Callers with no temperature field of their own (views/map-detail.js's
  // smaller local generator doesn't compute one) get a neutral mid-value,
  // which keeps them entirely in the temperate band -- the same
  // forest/plains/barrens/steppe (+ swamp) results this function always
  // produced for them, just via the new signature.
  temp = temp === undefined ? 0.5 : temp;
  if (h < seaLevel - 0.08) return 'deepwater';
  if (h < seaLevel) return 'shallowwater';
  if (h < seaLevel + 0.03) return 'beach';
  const hillsT = Math.max(seaLevel + 0.08, 0.55 - ruggedBias);
  const mountainsT = Math.max(hillsT + 0.05, 0.7 - ruggedBias);
  const snowT = Math.max(mountainsT + 0.05, 0.85 - ruggedBias);
  if (h > snowT) return 'snow';
  if (h > mountainsT) return 'mountains';
  if (h > hillsT) return 'hills';

  // Swamp check first: it can override any lowland climate band.
  if (h < seaLevel + OW_SWAMP_HEIGHT_OFFSET && moist > OW_SWAMP_MOIST_T) return 'swamp';

  const wetT = Math.min(0.9, Math.max(0.1, 0.5 - forestBias));
  // Barrens/desert mirrors wetT's own pattern at the opposite end of the
  // moisture range (floored strictly below wetT so forestBias can never
  // push the two thresholds past each other into a degenerate ordering) --
  // an arid lowland base biome, previously missing entirely (moisture below
  // wetT always fell through to plains regardless of how dry). Needed as
  // the base for the Bloodstone Desert / Salt Flats special-zone reflavors,
  // which recolor barrens cells rather than inventing their own band.
  const aridT = Math.max(0, Math.min(wetT - 0.15, 0.22 - forestBias * 0.5));
  // A second, stricter threshold below aridT -- carves barrens/desert down
  // to just the driest extreme (previously barrens alone owned everything
  // below aridT) and opens up a mid-dry band for the new steppe/savanna
  // dry-grassland categories, floored at 0 and strictly below aridT so
  // forestBias can never invert the two.
  const veryAridT = Math.max(0, aridT - 0.12);

  if (temp < OW_COLD_TEMP_T) {
    // Cold band: taiga (cold forest) vs. tundra, split at the same wetT
    // line temperate forest uses -- no separate arid tundra tier, since a
    // cold+dry cell already reads as tundra regardless of exactly how dry.
    return moist >= wetT ? 'taiga' : 'tundra';
  }
  if (temp >= OW_HOT_TEMP_T) {
    // Hot band: jungle / savanna / desert, mirroring the temperate band's
    // forest / plains+steppe / barrens structure one-for-one.
    if (moist >= wetT) return 'jungle';
    if (moist < veryAridT) return 'desert';
    return 'savanna';
  }
  // Temperate band (the original 3-way split, now with a steppe tier
  // carved out of what used to be the single "everything below aridT"
  // barrens band).
  if (moist >= wetT) return 'forest';
  if (moist < veryAridT) return 'barrens';
  if (moist < aridT) return 'steppe';
  return 'plains';
}

// Land biome categories rendered as a watercolor-wash overlay region
// (lib/watercolor-wash.js) on top of the flat land fill, one pass per
// category, each masked straight from biomeAt's own output via
// `cellData[i].biome === b` -- replaces the old hand-duplicated per-biome
// moisture-threshold masks (landForestAt/landBarrensAt), which only ever
// covered 2 of what are now 9 washed categories and had to keep their own
// copy of biomeAt's thresholds in sync by hand. `plains` is deliberately
// excluded: it stays the flat, unwashed base land color everything else
// paints over. `hills`/`mountains`/`snow` are also excluded: those remain
// a single combined height-driven wash (see the highland wash below),
// unchanged.
const OW_LOWLAND_WASH_BIOMES = ['forest', 'taiga', 'jungle', 'swamp', 'savanna', 'steppe', 'barrens', 'desert', 'tundra'];

// Relative cost of routing a road through each biome -- plains/beach are
// cheap, forest and hills cost more, mountains and snow cost the most.
// New climate biomes slot in near their nearest existing analog: open dry
// grassland (steppe/savanna) costs about what plains/beach already do,
// dense growth (taiga/jungle) costs more like forest, and the harshest
// ground (desert heat, tundra exposure, swamp mud) costs more than that --
// swamp specifically sits with snow/mountains, the two existing worst-case
// terrains, since boggy ground is genuinely one of the hardest surfaces to
// route a road through. Water isn't listed because computeRoadPath excludes
// water cells from the routable graph entirely (roads in this world don't
// cross open water).
const OW_TERRAIN_ROAD_COST = {
  beach: 1.2, plains: 1, forest: 1.3, hills: 2, mountains: 4, snow: 2.5, barrens: 1.5,
  steppe: 1.1, savanna: 1.2, desert: 1.8, tundra: 1.6, taiga: 1.6, jungle: 2.2, swamp: 2.8,
};

// Per-biome decorative texture drawn on top of the flat fill, using a
// dedicated rng consumed strictly in raster (row-major) order -- so it's
// fully deterministic per seed independent of settlement/road generation,
// which happens afterward against the (already-final) biome grid. Gated by
// probability per biome so it reads as texture/iconography, not a solid
// carpet of icons.
//
// `biomeColors` is the theme's whole palette.biomes dict (not just
// forest's own flat color) -- every canopy-shaded case below (forest,
// taiga, jungle) looks up its OWN biome's flat color to drive
// drawTreeCluster's light/dark/highlight shading, rather than every one of
// them borrowing forest's tone the way the old single-biome `canopyColor`
// parameter forced. `ink` alone has no color information to shade with.
function paintBiomeTexture(ctx, biome, cx, cy, cw, ch, rng, ink, biomeColors) {
  const r = rng();
  const canopyOf = (key, fallback) => (biomeColors && biomeColors[key]) || fallback;
  switch (biome) {
    case 'forest': {
      // Pom-pom tree clusters (lib/tree-clusters.js) -- replaces the old
      // two-tier conifer triangle. Confirmed directly against a real
      // Phandalin crop: WotC's own forest texture is a scatter of round,
      // overlapping, individually-lit canopy clusters, not a flat
      // silhouette.
      if (r > 0.85) return;
      const standCount = 1 + Math.floor(rng() * 2);
      for (let t = 0; t < standCount; t++) {
        const tx = cx + (rng() - 0.5) * cw * 0.6;
        const ty = cy + (rng() - 0.5) * ch * 0.4;
        const size = Math.min(cw, ch) * (0.32 + rng() * 0.18);
        drawTreeCluster(ctx, tx, ty, size, rng, canopyOf('forest', '#4a6b3a'), ink);
      }
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
    case 'taiga': {
      // Narrow dark conifer silhouette -- deliberately the OLD two-tier
      // triangle shape forest itself moved away from (see the round
      // pom-pom clusters above): now that it's free, it's a good fit for
      // "cold, spiky, coniferous" read as distinct from temperate forest's
      // round leafy canopy.
      if (r > 0.75) return;
      const standCount = 1 + Math.floor(rng() * 2);
      for (let t = 0; t < standCount; t++) {
        const tx = cx + (rng() - 0.5) * cw * 0.6;
        const ty = cy + (rng() - 0.5) * ch * 0.35;
        const s = Math.min(cw, ch) * (0.22 + rng() * 0.12);
        ctx.fillStyle = canopyOf('taiga', '#3a5a4c');
        ctx.beginPath();
        ctx.moveTo(tx, ty - s * 1.3); ctx.lineTo(tx - s * 0.32, ty - s * 0.3); ctx.lineTo(tx + s * 0.32, ty - s * 0.3);
        ctx.closePath(); ctx.fill();
        ctx.beginPath();
        ctx.moveTo(tx, ty - s * 0.5); ctx.lineTo(tx - s * 0.42, ty + s * 0.5); ctx.lineTo(tx + s * 0.42, ty + s * 0.5);
        ctx.closePath(); ctx.fill();
        ctx.strokeStyle = ink;
        ctx.globalAlpha = 0.6;
        ctx.lineWidth = 0.8;
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
      break;
    }
    case 'jungle': {
      // Dense overlapping canopy -- a bigger, darker, denser variant of
      // the forest pom-pom cluster (more stands, larger overlap, its own
      // deep-green tone) so a jungle mass reads as thick and crowded next
      // to forest's more open scatter.
      if (r > 0.55) return;
      const standCount = 2 + Math.floor(rng() * 3);
      for (let t = 0; t < standCount; t++) {
        const tx = cx + (rng() - 0.5) * cw * 0.75;
        const ty = cy + (rng() - 0.5) * ch * 0.55;
        const size = Math.min(cw, ch) * (0.4 + rng() * 0.24);
        drawTreeCluster(ctx, tx, ty, size, rng, canopyOf('jungle', '#1f5c34'), ink);
      }
      break;
    }
    case 'swamp': {
      // Reed-tuft clusters (a few thin fanned blades) plus an occasional
      // small water glint -- reads as "wet ground with standing water
      // pockets," distinct from both plains' single grass tick and
      // forest/jungle's canopy shapes.
      if (r < 0.55) {
        const reedCount = 2 + Math.floor(rng() * 2);
        ctx.strokeStyle = ink;
        ctx.globalAlpha = 0.45;
        ctx.lineWidth = 1;
        for (let t = 0; t < reedCount; t++) {
          const tx = cx + (rng() - 0.5) * cw * 0.7;
          const ty = cy + (rng() - 0.5) * ch * 0.5;
          const s = cw * (0.14 + rng() * 0.1);
          ctx.beginPath();
          ctx.moveTo(tx, ty + s * 0.5); ctx.quadraticCurveTo(tx - s * 0.15, ty - s * 0.3, tx - s * 0.35, ty - s);
          ctx.moveTo(tx, ty + s * 0.5); ctx.lineTo(tx, ty - s);
          ctx.moveTo(tx, ty + s * 0.5); ctx.quadraticCurveTo(tx + s * 0.15, ty - s * 0.3, tx + s * 0.35, ty - s);
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
      } else if (r < 0.72) {
        ctx.strokeStyle = ink;
        ctx.globalAlpha = 0.3;
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        ctx.arc(cx, cy, Math.max(0.8, cw * 0.09), 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
      break;
    }
    case 'savanna': {
      // Long wind-swept grass-dash strokes (longer/more curved than
      // plains' single lean tick), with a rare isolated umbrella-canopy
      // tree silhouette standing alone -- the classic savanna read.
      if (r < 0.4) {
        ctx.strokeStyle = ink;
        ctx.globalAlpha = 0.4;
        ctx.lineWidth = 1;
        for (let t = 0; t < 2; t++) {
          const tx = cx + (rng() - 0.5) * cw * 0.7;
          const ty = cy + (rng() - 0.5) * ch * 0.5;
          const lean = cw * (0.22 + rng() * 0.14);
          ctx.beginPath();
          ctx.moveTo(tx - lean * 0.5, ty + ch * 0.12);
          ctx.quadraticCurveTo(tx, ty - ch * 0.05, tx + lean * 0.5, ty - ch * 0.14);
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
      } else if (r < 0.48) {
        const s = Math.min(cw, ch) * 0.22;
        ctx.strokeStyle = ink;
        ctx.globalAlpha = 0.55;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(cx, cy + s * 0.9); ctx.lineTo(cx, cy - s * 0.2);
        ctx.stroke();
        ctx.fillStyle = canopyOf('savanna', '#c68a35');
        ctx.beginPath();
        ctx.ellipse(cx, cy - s * 0.35, s * 0.6, s * 0.22, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
      break;
    }
    case 'steppe': {
      // Shorter, more numerous wind-dash strokes than savanna, no trees --
      // open dry grassland rather than scattered-tree grassland.
      if (r > 0.45) return;
      ctx.strokeStyle = ink;
      ctx.globalAlpha = 0.4;
      ctx.lineWidth = 0.8;
      const tickCount = 2 + Math.floor(rng() * 2);
      for (let t = 0; t < tickCount; t++) {
        const tx = cx + (rng() - 0.5) * cw * 0.75;
        const ty = cy + (rng() - 0.5) * ch * 0.6;
        const lean = cw * (0.12 + rng() * 0.08);
        ctx.beginPath();
        ctx.moveTo(tx - lean * 0.5, ty + ch * 0.08);
        ctx.lineTo(tx + lean * 0.5, ty - ch * 0.1);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      break;
    }
    case 'desert': {
      // Sparse dune-line hachure (a shallow curved sweep, echoing
      // lib/hachure-terrain.js's contour-following strokes at a much
      // smaller per-point scale) with an occasional lone scrub tick.
      if (r < 0.4) {
        ctx.strokeStyle = ink;
        ctx.globalAlpha = 0.3;
        ctx.lineWidth = 0.8;
        const dw = cw * (0.35 + rng() * 0.2);
        const dy = (rng() - 0.5) * ch * 0.4;
        ctx.beginPath();
        ctx.moveTo(cx - dw, cy + dy + ch * 0.08);
        ctx.quadraticCurveTo(cx, cy + dy - ch * 0.08, cx + dw, cy + dy + ch * 0.08);
        ctx.stroke();
        ctx.globalAlpha = 1;
      } else if (r < 0.5) {
        ctx.strokeStyle = ink;
        ctx.globalAlpha = 0.3;
        ctx.lineWidth = 0.8;
        const s = cw * 0.06;
        ctx.beginPath();
        ctx.moveTo(cx, cy + s); ctx.lineTo(cx, cy - s * 0.4);
        ctx.moveTo(cx, cy - s * 0.1); ctx.lineTo(cx - s * 0.5, cy - s * 0.6);
        ctx.moveTo(cx, cy - s * 0.1); ctx.lineTo(cx + s * 0.5, cy - s * 0.6);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
      break;
    }
    case 'tundra': {
      // Sparse lichen/stipple texture -- a loose scatter of tiny dots,
      // lighter and more diffuse than beach's single dot, reading as
      // "sparse ground cover" rather than a distinct plant or grain.
      if (r > 0.4) return;
      ctx.fillStyle = ink;
      ctx.globalAlpha = 0.3;
      const dotCount = 2 + Math.floor(rng() * 3);
      for (let t = 0; t < dotCount; t++) {
        const tx = cx + (rng() - 0.5) * cw * 0.8;
        const ty = cy + (rng() - 0.5) * ch * 0.8;
        ctx.beginPath();
        ctx.arc(tx, ty, Math.max(0.4, cw * 0.025), 0, Math.PI * 2);
        ctx.fill();
      }
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

// (OW_TERRAIN_ROAD_COST now lives up near biomeAt/OW_LOWLAND_WASH_BIOMES,
// grouped with the rest of the biome-classification constants it depends
// on.)

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
// Generalized to any biome with a matching palette.wash entry (mountains
// special-cased to hills' own wash tone, since the two share one combined
// terrain wash -- see OW_LOWLAND_WASH_BIOMES/the highland wash above) --
// picks up every new climate biome (taiga/jungle/swamp/savanna/steppe/
// desert/tundra) for free rather than needing its own hand-listed case.
function labelColorFor(biome, palette) {
  const washKey = biome === 'mountains' ? 'hills' : biome;
  const tone = palette.wash[washKey] || null;
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
    { type: 'swatch', color: palette.biomes.steppe, label: 'Steppe' },
    { type: 'swatch', color: palette.biomes.savanna, label: 'Savanna' },
    { type: 'swatch', color: palette.biomes.desert, label: 'Desert' },
    { type: 'swatch', color: palette.biomes.tundra, label: 'Tundra' },
    { type: 'swatch', color: palette.biomes.taiga, label: 'Taiga' },
    { type: 'swatch', color: palette.biomes.jungle, label: 'Jungle' },
    { type: 'swatch', color: palette.biomes.swamp, label: 'Swamp' },
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

  let worldCache = null;
  function buildWorld(seed, cellCount, octaves, island, seaLevel, riversOn, settleCount, wildZonesOn) {
    // canvas.width/height join the key the moment canvas size can vary (the Continent preset uses a
    // bigger canvas) -- without this, switching scale tiers could silently reuse a mesh/heightmap sized
    // for the wrong canvas. wildZonesOn joins it for the same reason the other checkboxes already do.
    const key = [seed, cellCount, octaves, island, seaLevel, riversOn, settleCount, wildZonesOn, canvas.width, canvas.height].join('|');
    if (worldCache && worldCache.key === key) return worldCache;
    // Through the shared one-world cache so a zoom into this map (views/map-detail.js) reuses it.
    worldCache = cachedOverworldWorld({ seed, cellCount, octaves, island, seaLevel, riversOn, settleCount }, canvas.width, canvas.height);
    worldCache.key = key;
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
  // async + yieldToPaint so the progress overlay can repaint between
  // phases -- see lib/generation-progress.js. `fast` (live slider-drag
  // ticks) skips the overlay entirely via the no-op stub below: those ticks
  // are deliberately kept as fast as before, since the whole point of the
  // live sliders is fluid drag feedback (see scheduleLiveRegen's own
  // comment), not a progress bar for a sub-second redraw.
  async function generate(fast) {
    const progress = fast ? { update() {}, done() {} } : showGenerationProgress(canvas, 'Building world…');
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

    // hillsT/mountainsT/snowT mirror biomeAt's own internal height
    // formulas exactly (kept in sync by hand -- biomeAt still owns
    // per-cell classification for settlement/road/theme-suggestion logic
    // below; these copies are only for driving marching-squares contour
    // extraction against the same continuous height field, for the highland
    // wash/rosette-threshold/snow-fill/range-zone passes below). The old
    // forestT/aridT copies are gone: the lowland biome washes below now
    // extract straight from cellData[i].biome (biomeAt's own output) rather
    // than a hand-duplicated moisture-threshold formula, so there's nothing
    // left to keep in sync for those.
    const hillsT = Math.max(seaLevel + 0.08, 0.55 - ruggedBias);
    const mountainsT = Math.max(hillsT + 0.05, 0.7 - ruggedBias);
    const snowT = Math.max(mountainsT + 0.05, 0.85 - ruggedBias);

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
    const roadRng = mulberry32(seed + 21212);

    // buildWorld itself (mesh + hydraulic erosion + hydrology + settlement/
    // road scoring) is one opaque synchronous call -- on a real cache miss
    // it can't yield partway through without a much larger refactor of its
    // internals, so the progress overlay can only actually repaint starting
    // from this point onward. It's cached (see buildWorld's own comment),
    // so this cost is paid once per {seed, cellCount, ...} combination, not
    // on every render.
    const world = buildWorld(seed, cellCount, octaves, island, seaLevel, riversOn, settleCount, wildZonesOn);
    const {
      mesh, heights, cols, rows, cellW, cellH,
      mOf, tOf, refBiomeOf, flow, downhill, isLake, riverThreshold, nearRiver,
      regionOf, regionCategory, settlements, roadPaths,
      wetlowlandOf, rangeIndexOf, rangeZoneOf, regionZoneOf,
      lakeIdOf, largestLakeId, landmarks,
    } = world;
    await yieldToPaint();
    progress.update(0.2, 'Painting terrain…');

    // `biome` is the LIVE classification (Vegetation/Ruggedness sliders
    // applied) used for the actual fill colors/texture/legend/theme-
    // suggestion stats below -- cheap to recompute every render (a plain
    // threshold check per cell against the already-cached height/moisture).
    // `refBiome` comes straight from the cache: settlement placement,
    // naming regions, and road routing were all built against it already,
    // so dragging a slider only repaints the terrain's coloring and never
    // moves a settlement, renames a region, or reroutes a road.
    const cellData = mesh.cells.map((cell, i) => ({
      cell, h: heights[i], m: mOf[i], t: tOf[i],
      biome: biomeAt(heights[i], mOf[i], tOf[i], seaLevel, forestBias, ruggedBias),
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
        if (biome === 'hills' || biome === 'mountains' || OW_LOWLAND_WASH_BIOMES.includes(biome)) continue; // wash+icon pass below, gated by !fast
        paintBiomeTexture(ctx, biome, px, py, spacing, spacing, textureRng, palette.ink, palette.biomes);
      }
    }

    if (!fast) {
      await yieldToPaint();
      progress.update(0.4, 'Painting highlands & forests…');
      // Lowland biome washes: one overlay region per non-plains lowland
      // category -- temperate forest/barrens plus the newer climate-driven
      // taiga/jungle/swamp/savanna/steppe/desert/tundra (OW_LOWLAND_WASH_
      // BIOMES) -- each masked straight from cellData[i].biome, i.e. the
      // SAME classification driving the texture/legend/settlement logic
      // elsewhere, rather than a hand-rolled moisture-threshold copy of
      // biomeAt's own thresholds (the old landForestAt/landBarrensAt,
      // which only ever covered 2 of these 9 categories and could drift
      // out of sync with biomeAt by hand-edit). `plains` stays the flat,
      // unwashed base land color underneath all of these, matching before.
      // Cheap presence pre-check (a plain pass over the already-in-memory
      // cellData array) skips the marching-squares extraction entirely for
      // any biome absent from this particular map, rather than paying a
      // full cols*rows scan on every one of the 9 categories regardless of
      // whether it actually appears here.
      const presentBiomes = new Set(cellData.map((c) => c.biome));
      for (const b of OW_LOWLAND_WASH_BIOMES) {
        if (!presentBiomes.has(b)) continue;
        const biomeMaskAt = (i) => (cellData[i].biome === b ? 1 : 0);
        const loops = extractFillableRegions(cols, rows, cellW, cellH, biomeMaskAt, 0.5, canvas.width, canvas.height, minLoopArea);
        if (loops.length === 0) continue;
        ctx.save();
        clipToLoops(landLoops.length ? landLoops : beachLoops);
        for (const group of groupChainsIntoLoops(loops)) {
          paintWatercolorWash(ctx, group, washRng, palette.wash[b], palette.ink, 28);
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
          } else if (OW_LOWLAND_WASH_BIOMES.includes(biome)) {
            paintBiomeTexture(ctx, biome, px, py, spacing, spacing, textureRng, palette.ink, palette.biomes);
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

    // Contour-hachure ground texture (lib/hachure-terrain.js) -- see its
    // own header comment. Gated behind !fast (skipped on live slider-drag
    // ticks, same as the wash/rosette passes) since it's tens of
    // thousands of strokes at this canvas size -- real cost, deliberately
    // spent on a full-quality render, not on a sub-second drag tick whose
    // whole point is staying fluid.
    if (!fast) {
      await yieldToPaint();
      progress.update(0.55, 'Inking ground texture…');
      const hachureRng = mulberry32(seed + 63819);
      function hachureHeightAt(x, y) {
        const gx = Math.min(cols - 1, Math.max(0, Math.floor(x / cellW)));
        const gy = Math.min(rows - 1, Math.max(0, Math.floor(y / cellH)));
        return heights[gy * cols + gx];
      }
      paintHachureField(ctx, canvas.width, canvas.height, hachureRng, palette.ink, hachureHeightAt, (x, y) => hachureHeightAt(x, y) < seaLevel);
    }

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

    await yieldToPaint();
    progress.update(0.6, 'Carving rivers & lakes…');
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
    // only draw them. strokeOrganicRoad (lib/organic-roads.js) replaces the
    // old flat 2px stroke -- a modest ribbon width at this region scale
    // (not settlement-lane width, which would look absurd zoomed out this
    // far), Chaikin-smoothed with the same double-stroke halo edge the
    // coastline/river passes above already use.
    for (const pts of roadPaths) {
      strokeOrganicRoad(ctx, pts, { color: palette.road, edgeColor: palette.ink, width: 3.5, rng: roadRng, surface: 'stone' });
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
    }

    // Labels: a separate pass, city-before-town-before-village, with simple
    // bounding-box collision avoidance -- minDist above only spaces marker
    // POINTS, which says nothing about how wide a rendered name actually
    // is, so nearby settlements' labels could still visibly pile into an
    // illegible cluster even with icons properly spaced (confirmed
    // directly from a real map). Every icon above always draws regardless;
    // only the text label is ever skipped, and only when it would collide
    // with a higher-priority label already placed, so a crowded region
    // still shows where every settlement is, just not all of their names.
    const labelPriority = { city: 0, town: 1, village: 2 };
    const sortedForLabels = settlements.slice().sort((a, b) => labelPriority[a.tier] - labelPriority[b.tier]);
    const placedLabelBoxes = [];
    for (const s of sortedForLabels) {
      const px = s.x, py = s.y;
      const r = OW_TIER_RADIUS[s.tier];
      ctx.font = OW_TIER_FONT[s.tier];
      const textWidth = ctx.measureText(s.name).width;
      const boxX1 = px - textWidth / 2 - 2, boxX2 = px + textWidth / 2 + 2;
      const boxY1 = py + r + 3, boxY2 = boxY1 + 11;
      const overlaps = placedLabelBoxes.some((b) => boxX1 < b.x2 && boxX2 > b.x1 && boxY1 < b.y2 && boxY2 > b.y1);
      if (overlaps) continue;
      placedLabelBoxes.push({ x1: boxX1, y1: boxY1, x2: boxX2, y2: boxY2 });
      // refBiome, not the live-biased biome -- matches convention #3
      // (settlement-adjacent visuals stay fixed under the live sliders).
      // Halo label (lib/map-labels.js) instead of plain fillText -- a
      // real WotC regional map's settlement names sit directly on a busy
      // hachured/washed ground and stay legible via exactly this white
      // halo, not by finding empty space to sit in.
      drawHaloLabel(ctx, s.name, px, py + r + 8, undefined, undefined, { font: OW_TIER_FONT[s.tier], ink: labelColorFor(cellData[s.index].refBiome, palette) });
    }

    // Point-feature wild-zone landmarks (Ley Line Nexus, Astral Scar,
    // Giant's Garden, Sunken Ruins) -- placed once in buildWorld,
    // drawn here the same way settlements are: straight from the cache,
    // no live-slider dependence.
    if (wildZonesOn) {
      for (const lm of landmarks) {
        drawWildZoneIcon(ctx, lm.x, lm.y, lm.key, palette.ink);
        drawHaloLabel(ctx, lm.name, lm.x, lm.y + 14, undefined, undefined, { font: OW_TIER_FONT.village, ink: palette.label });
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
    // Pre-seeded with the original 6 keys lib/campaign-themes.js's
    // suggestCampaignTheme reads directly (s.biome.mountains, .forest,
    // etc.) so those lookups stay defined (0, not undefined -> NaN) even on
    // a map with zero cells of that biome; every OTHER biome (including the
    // new climate categories) still accumulates correctly via the `|| 0`
    // fallback below, just without suggestCampaignTheme's heuristic
    // currently reading them.
    const landBiomeCounts = { plains: 0, forest: 0, hills: 0, mountains: 0, snow: 0, barrens: 0 };
    let beachCount = 0, landCount = 0;
    for (const { biome } of cellData) {
      if (biome === 'deepwater' || biome === 'shallowwater') continue;
      landCount++;
      if (biome === 'beach') { beachCount++; continue; }
      landBiomeCounts[biome] = (landBiomeCounts[biome] || 0) + 1;
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
    progress.done();
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
  const SETTLEMENT_ZOOM_FACTOR = OW_SETTLEMENT_ZOOM_FACTOR;
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
  wireMapExportSave(container, canvas, 'ow', async (offCtx) => {
    const prevCtx = ctx;
    ctx = offCtx;
    await generate(false);
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
      await generate(false);
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
