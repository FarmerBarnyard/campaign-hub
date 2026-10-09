// The overworld's world model: mesh, heights, erosion, temperature, hydrology, moisture, biomes,
// naming regions, wild zones, settlements, landmarks and roads -- everything views/map-overworld.js
// computes once per {seed, cell count, octaves, island, sea level, rivers, settlements, canvas size}
// and then only paints. It is a pure function of those numbers (no DOM, no canvas), so the same world
// can be rebuilt anywhere: by the overworld page, by the zoom-in detail map (which samples a chosen
// window of it instead of inventing new terrain), and by the headless mapgen service.
//
// This was extracted verbatim from renderOverworldMap's buildWorld closure; the only edits are that
// canvas.width/height became the `width`/`height` arguments and the settlement zoom constant now
// lives here. test/overworld-world.test.js holds digests captured from the pre-extraction code, so any
// drift in the generated world fails a test rather than quietly changing every saved map.
//
// Globals it relies on (loaded before it is CALLED, not before it is parsed): lib/noise.js,
// voronoi-mesh.js, terrain-grid.js, hydrology.js, settlement-names.js, map-biome-zones.js,
// biomeAt/computeRoadPath (views/map-overworld.js) and SETTLEMENT_CANVAS_SIZE/SETTLEMENT_TIER_CONFIG
// (views/map-settlement.js).

// Above this cell count the generator takes the multi-range Continent branch; at or below it, every
// branch is the original Standard-tier path, byte-for-byte.
const CONTINENT_CELL_THRESHOLD = 70000;
// The settlement map shows a window 1/OW_SETTLEMENT_ZOOM_FACTOR of the overworld across (used to size
// how much land a city or town needs around it).
const OW_SETTLEMENT_ZOOM_FACTOR = 2;

// params: { seed, cellCount, octaves, island, seaLevel, riversOn, settleCount }; width/height are
// the canvas size the world is laid out on (800x600 Standard, 1600x1200 Continent).
function buildOverworldWorld(params, width, height) {
  const { seed, cellCount, octaves, island, seaLevel, riversOn, settleCount } = params;

const meshRng = mulberry32(seed + 77777);
  const mesh = buildTerrainGrid(meshRng, width, height, cellCount);
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
  const cx = width / 2, cy = height / 2, maxD = Math.hypot(cx, cy);

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
  const edgeMarginX = width * 0.035, edgeMarginY = height * 0.035;
  function edgeFalloff(x, y) {
    const fx = Math.min(x, width - x) / edgeMarginX;
    const fy = Math.min(y, height - y) / edgeMarginY;
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
    ridgeContribution = (x, y) => ridgedSample(x / width, y / height);
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
    const u = cell.x / width, v = cell.y / height;
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

  // Temperature field (0 = coldest, 1 = hottest) -- computed alongside
  // heights/mOf, post-erosion, so the altitude-cooling term below reads
  // the final terrain rather than the pre-erosion noise field. Not wired
  // into biomeAt() itself (that's owned by a separate biome-classification
  // effort) -- this just guarantees tOf[i] exists, populated, indexed the
  // same way as heights[i]/mOf[i], by the time biomeAt's call sites run.
  // Standard "latitude minus altitude plus noise" recipe, with one twist:
  // instead of hardcoding y as the north-south axis (which would make
  // every world cold-north/hot-south identically), each seed rolls its
  // own "equator line" -- an angle through the map center plus a small
  // perpendicular offset -- and temperature is hottest ON that line,
  // falling off toward either side of it (i.e. two "poles," same as real
  // latitude, just at a random orientation/offset per seed instead of
  // always the top/bottom canvas edges).
  const tempRng = mulberry32(seed + 51413);
  const equatorAngle = tempRng() * Math.PI * 2;
  const equatorNx = Math.sin(equatorAngle), equatorNy = -Math.cos(equatorAngle); // unit normal to the equator line
  const equatorOffset = (tempRng() - 0.5) * 0.6; // fraction of maxD, shifts the hot band off-center
  // Own seeded noise stream (5-6 digit constant not used elsewhere in this
  // file) for small regional temperature variation, same makeFbmSampler
  // convention as moistureSample above.
  const tempNoiseSample = makeFbmSampler(mulberry32(seed + 62909), 3);
  const tOf = new Float64Array(mesh.cells.length);
  mesh.cells.forEach((cell, i) => {
    const dx = cell.x - cx, dy = cell.y - cy;
    // Signed distance from the equator line, normalized so the canvas
    // corners land at roughly +/-1.
    const latSigned = (dx * equatorNx + dy * equatorNy) / maxD - equatorOffset;
    // 1 at the equator line, fading to 0 at either "pole" -- a band, not a
    // corner-to-corner ramp, so temperature wraps the way real latitude
    // does rather than reading as one hot edge and one cold edge.
    const latitude = Math.max(0, 1 - Math.abs(latSigned));
    // Higher elevation reads colder at the same latitude -- strong enough
    // that a tall mountain can read as cold even sitting on the equator
    // line itself, not just nudge the value slightly.
    const altitudeCooling = Math.max(0, heights[i] - seaLevel) * 0.85;
    const regionalNoise = (tempNoiseSample(cell.x / width, cell.y / height) - 0.5) * 0.25;
    tOf[i] = Math.max(0, Math.min(1, latitude - altitudeCooling + regionalNoise));
  });

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
  // since biomeAt only ever compares moisture against its own internal
  // wetT/aridT lines regardless of where that moisture value came from.
  // tOf (built above) is threaded through as biomeAt's third axis --
  // refBiomeOf is the bias-independent reference classification, same
  // temperature value the LIVE `biome` field in generate() below uses.
  const moistureSample = makeFbmSampler(mulberry32(seed + 99991), Math.max(1, octaves - 1));
  const regionalMoisture = rangeCount > 1 ? makeFbmSampler(mulberry32(seed + 91919), 2) : null;
  const mOf = new Float64Array(mesh.cells.length);
  const refBiomeOf = new Array(mesh.cells.length);
  mesh.cells.forEach((cell, i) => {
    let m = moistureSample(cell.x / width, cell.y / height);
    if (regionalMoisture) {
      const regional = regionalMoisture(cell.x / width, cell.y / height);
      m = m * 0.75 + regional * 0.25;
    }
    m = Math.min(1, m + nearRiver[i] * 0.3);
    mOf[i] = m;
    refBiomeOf[i] = biomeAt(heights[i], m, tOf[i], seaLevel, 0, 0);
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
  // Floored at 28px: the raw formula scales minDist DOWN as settleCount
  // goes up (more requested settlements on a fixed canvas necessarily
  // means tighter spacing), which is reasonable for the marker points
  // themselves but, at higher settlement counts, could shrink well below
  // the size of the icons/labels actually being drawn there -- confirmed
  // directly from a real map showing a dense pile of overlapping town
  // icons and names in one region. The floor keeps icons visually
  // distinct from their immediate neighbors regardless of how many
  // settlements were requested; it does NOT guarantee label text (which
  // varies in width per name) won't still collide -- that's handled
  // separately at draw time below, since it can't be solved by point
  // spacing alone.
  const minDist = Math.max(28, Math.max(width, height) / (settleCount + 1) * 0.6);
  const settlements = [];
  for (const c of candidates) {
    if (settlements.length >= settleCount) break;
    if (settlements.every((s) => Math.hypot(s.x - c.x, s.y - c.y) >= minDist)) settlements.push(c);
  }
  const byScore = settlements.slice().sort((a, b) => b.score - a.score);
  const cityCount = Math.max(1, Math.round(byScore.length * 0.15));
  const townCount = Math.max(0, Math.round(byScore.length * 0.35));

  // Tiers were previously assigned on score rank alone -- the top 15%
  // of sites became cities regardless of whether the ground could hold
  // one. That routinely put a city on a narrow headland or spit, and
  // once the settlement generator started fitting its footprint to the
  // real shoreline, those sites rendered as a sparse crescent of
  // buildings jammed against the frame: a correct drawing of an
  // impossible town. A tier now has to EARN its size -- the site is
  // checked for how much of that tier's actual footprint is land
  // before it's allowed to claim it.
  //
  // The settlement map shows a window of this map
  // (OW_SETTLEMENT_ZOOM_FACTOR) painted onto a fixed square canvas, and
  // that window is not square, so a tier's radius maps to a different
  // overworld distance horizontally than vertically -- hence the
  // separate x/y scales and the elliptical sampling below.
  const owPerSettlementX = (width / OW_SETTLEMENT_ZOOM_FACTOR) / SETTLEMENT_CANVAS_SIZE;
  const owPerSettlementY = (height / OW_SETTLEMENT_ZOOM_FACTOR) / SETTLEMENT_CANVAS_SIZE;
  function landFractionFor(s, tier) {
    const radius = SETTLEMENT_TIER_CONFIG[tier].radius;
    const rx = radius * owPerSettlementX, ry = radius * owPerSettlementY;
    const steps = 9;
    let land = 0, total = 0;
    for (let iy = -steps; iy <= steps; iy++) {
      for (let ix = -steps; ix <= steps; ix++) {
        const fx = ix / steps, fy = iy / steps;
        if (fx * fx + fy * fy > 1) continue;
        total++;
        const px = s.x + fx * rx, py = s.y + fy * ry;
        // Off-canvas counts as not-land: a site hard against the map
        // edge has no room for a full footprint either.
        if (px < 0 || py < 0 || px >= width || py >= height) continue;
        const gx = Math.min(cols - 1, Math.max(0, Math.floor(px / cellW)));
        const gy = Math.min(rows - 1, Math.max(0, Math.floor(py / cellH)));
        if (heights[gy * cols + gx] >= seaLevel + 0.02) land++;
      }
    }
    return total ? land / total : 0;
  }

  // Filled highest tier first, each slot going to the best-scoring site
  // that can actually hold it -- so a city lands on a site with room
  // for a city rather than simply on the top-scoring site. If no site
  // qualifies, the map genuinely has no city, which is the honest
  // result for a chain of small islands.
  const tierOf = new Array(byScore.length).fill(null);
  function fillTier(tier, slots, minLandFraction) {
    let filled = 0;
    for (let i = 0; i < byScore.length && filled < slots; i++) {
      if (tierOf[i]) continue;
      if (landFractionFor(byScore[i], tier) < minLandFraction) continue;
      tierOf[i] = tier;
      filled++;
    }
  }
  // Thresholds measured, not guessed: sampling land fractions across
  // several real seeds put the headland site that prompted this fix at
  // 0.39 of a city footprint, a healthy inland-ish city site at 0.77,
  // and solid town sites in the 0.6-0.9 band. A small island chain
  // legitimately ends up with no city under these numbers, which is
  // the honest answer for that geography rather than a bug.
  fillTier('city', cityCount, 0.70);
  fillTier('town', townCount, 0.55);

  byScore.forEach((s, i) => {
    s.tier = tierOf[i] || 'village';
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
  const minLandmarkDist = Math.max(width, height) * 0.06;
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

  return {
    mesh, heights, cols, rows, cellW, cellH,
    mOf, tOf, refBiomeOf, flow, downhill, isLake, riverThreshold, nearRiver,
    regionOf, regionCategory, settlements, roadPaths,
    wetlowlandOf, rangeIndexOf, rangeZoneOf, regionZoneOf,
    lakeIdOf, largestLakeId, landmarks,
  };
}

