// Structured site map for a wild-zone point landmark (Ley Line Nexus/
// Astral Scar/Giant's Garden/Sunken Ruins) -- drilled into from clicking a
// landmark icon on the overworld map (map-overworld.js's hitTestLandmark/
// buildLandmarkMapUrl). This is the dedicated view the account owner asked
// for: settlements already get their own purpose-built generator
// (map-settlement.js) rather than routing through the generic terrain-zoom
// path, and landmarks needed the identical treatment -- a real explorable
// site (rooms/corridors/purpose labels, themed per landmark type) with GM
// reference text alongside it, sitting in front of real backdrop terrain,
// not a zoomed screenshot with a label bolted on.
//
// Seed is derived the same "nothing to desync" way map-settlement.js's
// deriveSettlementSeed and map-detail.js's deriveDetailSeed already are --
// a distinct scaleTag from deriveDetailSeed's own (800) keeps this view's
// seed space cleanly separate from an ordinary detail-map click that
// happened to land on the exact same parent pixel.
function deriveLandmarkSeed(overworldSeed, x, y) {
  return deriveDetailSeed(overworldSeed, x, y, 424242);
}

// Places `roomCount` non-overlapping rectangular room seeds by rejection
// sampling (not a full BSP split like map-dungeon.js -- a landmark site is
// meant to read as one explorable location, 3-8 rooms, not a maze; BSP's
// guaranteed-full-coverage recursion is the wrong tool at this scale and
// would need its own room-count/depth tuning to avoid either one giant
// room or a cramped grid). Shapes are decided and carved up front, before
// any corridor is placed, so -- unlike the dungeon generator -- no
// carve-then-reconnect-doorways pass is needed: lib/room-shapes.js's
// carveCorridor only ever converts ROCK cells and guards against
// overwriting floor, so connecting already-shaped rooms center-to-center
// afterward can't sever anything.
function buildSiteLayout(rng, gw, gh, roomCount, theme) {
  const grid = [];
  for (let y = 0; y < gh; y++) grid.push(new Array(gw).fill(0));
  const rooms = [];
  const minRoomSize = 3, maxRoomSize = 6;
  let attempts = 0;
  while (rooms.length < roomCount && attempts < 300) {
    attempts++;
    const rw = minRoomSize + Math.floor(rng() * (maxRoomSize - minRoomSize + 1));
    const rh = minRoomSize + Math.floor(rng() * (maxRoomSize - minRoomSize + 1));
    const rx = 1 + Math.floor(rng() * Math.max(1, gw - rw - 2));
    const ry = 1 + Math.floor(rng() * Math.max(1, gh - rh - 2));
    // 1-cell padding between rooms so corridors always have rock to carve
    // through, and no two rooms ever visually touch.
    const overlaps = rooms.some((r) =>
      rx < r.rx + r.rw + 1 && rx + rw + 1 > r.rx && ry < r.ry + r.rh + 1 && ry + rh + 1 > r.ry);
    if (overlaps) continue;
    rooms.push({ rx, ry, rw, rh, cx: rx + Math.floor(rw / 2), cy: ry + Math.floor(rh / 2), shape: 'rect' });
  }
  if (rooms.length === 0) {
    // Degenerate fallback (a tiny gw/gh could reject every attempt) -- one
    // room, dead center, better than an empty site.
    const rw = Math.min(6, gw - 2), rh = Math.min(6, gh - 2);
    const rx = Math.floor((gw - rw) / 2), ry = Math.floor((gh - rh) / 2);
    rooms.push({ rx, ry, rw, rh, cx: rx + Math.floor(rw / 2), cy: ry + Math.floor(rh / 2), shape: 'rect' });
  }

  // The largest room is the site's heart -- gets the theme's centralPurpose
  // label and the landmark's own drawWildZoneIcon glyph (see generate()
  // below), matching how the overworld itself marks this same landmark.
  let heart = rooms[0];
  for (const r of rooms) if (r.rw * r.rh > heart.rw * heart.rh) heart = r;
  heart.purpose = theme.centralPurpose;
  heart.isHeart = true;

  // Every other room draws a purpose label from the theme's pool without
  // repeats until exhausted, then reshuffles -- concrete "purpose
  // vocabulary, not just geometry."
  const purposePool = theme.roomPurposes.slice();
  for (const room of rooms) {
    if (room === heart) continue;
    if (purposePool.length === 0) purposePool.push(...theme.roomPurposes);
    const idx = Math.floor(rng() * purposePool.length);
    room.purpose = purposePool[idx];
    purposePool.splice(idx, 1);
  }

  // Shape rolls from the theme's own pool (favoring cave/circle/octagon/
  // lshape combinations distinct per landmark type -- see
  // lib/landmark-sites.js) rather than a flat/uniform roll, so the four
  // landmark types read as visibly different floor plans, not just
  // different paint on the same shape mix.
  rooms.forEach((room) => {
    if (theme.shapePool.length && rng() < 0.65) {
      room.shape = theme.shapePool[Math.floor(rng() * theme.shapePool.length)];
    }
  });

  rooms.forEach((room) => {
    if (room.shape === 'rect') {
      for (let y = room.ry; y < room.ry + room.rh; y++) for (let x = room.rx; x < room.rx + room.rw; x++) grid[y][x] = 1;
    } else if (room.shape === 'circle') {
      carveCircleRoom(grid, room.rx, room.ry, room.rw, room.rh);
    } else if (room.shape === 'octagon') {
      carveOctagonRoom(grid, room.rx, room.ry, room.rw, room.rh);
    } else if (room.shape === 'lshape') {
      carveLShapeRoom(grid, room.rx, room.ry, room.rw, room.rh, rng);
    } else if (room.shape === 'cave') {
      carveCaveRoom(grid, gw, gh, room.rx, room.ry, room.rw, room.rh, room.cx, room.cy, rng);
    }
    // Every carve function already guarantees this, but cheap and harmless
    // to assert directly -- the corridor MST below connects to (cx,cy).
    if (room.cy >= 0 && room.cy < gh && room.cx >= 0 && room.cx < gw) grid[room.cy][room.cx] = 1;
  });

  // Connect every room with a minimum-spanning tree of corridors (Prim's
  // algorithm, Manhattan distance between centers) -- guarantees full
  // connectivity with the fewest corridors, appropriate for a small site
  // where a maze of redundant passages would feel wrong.
  const connected = new Set([0]);
  while (connected.size < rooms.length) {
    let best = null, bestDist = Infinity;
    for (const i of connected) {
      for (let j = 0; j < rooms.length; j++) {
        if (connected.has(j)) continue;
        const d = Math.abs(rooms[i].cx - rooms[j].cx) + Math.abs(rooms[i].cy - rooms[j].cy);
        if (d < bestDist) { bestDist = d; best = { i, j }; }
      }
    }
    if (!best) break;
    carveCorridor(grid, rooms[best.i], rooms[best.j]);
    connected.add(best.j);
  }

  return { grid, gw, gh, rooms };
}

function renderLandmarkMap(container, params) {
  const overworldSeed = parseInt(params.get('seed'), 10) || 1;
  const clickX = parseFloat(params.get('x')) || 0;
  const clickY = parseFloat(params.get('y')) || 0;
  const biome = params.get('biome') || 'plains';
  const targetAvgHeight = clampParam(params.get('h'), 0.5);
  const targetAvgMoisture = clampParam(params.get('m'), 0.5);
  const sea = clampParam(params.get('sea'), 0.42);
  const zone = findZoneByKey(params.get('zone'));
  const poiKey = LANDMARK_SITE_THEMES[params.get('poi')] ? params.get('poi') : 'sunkenRuins';
  const poiLabel = params.get('poiLabel') || 'Landmark';
  const poiName = params.get('poiName') || poiLabel;
  const seed = deriveLandmarkSeed(overworldSeed, clickX, clickY);
  const sampleGuide = parseGuideParam(params);
  const theme = LANDMARK_SITE_THEMES[poiKey];

  container.innerHTML = `
    <h2 id="lm-heading">${poiName}</h2>
    <p><a href="#/map/overworld">&larr; Back to overworld map</a></p>
    <div class="map-layout">
      <div class="map-controls">
        <label>Theme <select id="lm-theme"></select></label>
        <p class="status-text">Derived from overworld seed ${overworldSeed} at this location -- fixed, can't be reseeded independently.</p>
        <hr>
        <button id="lm-export">Export PNG</button>
        <label>Save as <input id="lm-filename" placeholder="filename.png" autocomplete="off"></label>
        <label>Campaign <select id="lm-campaign"></select></label>
        <button id="lm-save">Save to campaign</button>
        <p id="lm-status" class="status-text"></p>
      </div>
      <canvas id="lm-canvas" width="${DETAIL_CANVAS_W}" height="${DETAIL_CANVAS_H}"></canvas>
    </div>
    <div class="landmark-lore" id="lm-lore"></div>
  `;

  populateCampaignSelect(container.querySelector('#lm-campaign'));
  populateThemeSelect(container.querySelector('#lm-theme'));

  const canvas = container.querySelector('#lm-canvas');
  // `let`, not `const` -- wireMapExportSave's high-res export temporarily
  // points this at an offscreen context so generate() redraws there instead
  // of the on-screen canvas, then restores it (same convention as every
  // other generator here). The lore panel is plain DOM text, not part of
  // the canvas, so it's unaffected by (and irrelevant to) that export path
  // -- matches every other generator's "canvas is the export unit"
  // convention.
  let ctx = canvas.getContext('2d');

  function generate() {
    const themeObj = MAP_THEMES[container.querySelector('#lm-theme').value] || MAP_THEMES[MAP_THEME_DEFAULT];
    const palette = themeObj.overworld;

    // Dedicated streams: site layout and lore text must never perturb the
    // backdrop terrain (renderTerrainPatch owns its own streams entirely)
    // or each other, same isolation convention as every generator here.
    const grainRng = mulberry32(seed + 14683);
    const borderRng = mulberry32(seed + 25791);
    const siteRng = mulberry32(seed + 337799);
    const loreRng = mulberry32(seed + 445566);

    renderTerrainPatch(ctx, canvas, { seed, sea, targetAvgHeight, targetAvgMoisture, sampleGuide, zone, palette });

    // Inset panel: the site is the dominant subject, terrain is backdrop --
    // a framed parchment card roughly centered on the canvas, in the same
    // "hand-drawn card over the map" spirit as map-dungeon.js's own legend
    // card, just much larger since it's the main content here.
    const insetW = 520, insetH = 420;
    const insetX = (canvas.width - insetW) / 2;
    const insetY = (canvas.height - insetH) / 2 - 10;
    const accentColor = `hsl(${palette.wash[theme.accentWashKey].h}, ${palette.wash[theme.accentWashKey].s}%, ${palette.wash[theme.accentWashKey].l}%)`;

    ctx.save();
    ctx.globalAlpha = 0.94;
    ctx.fillStyle = palette.biomes.beach;
    ctx.fillRect(insetX, insetY, insetW, insetH);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = palette.coastline;
    ctx.lineWidth = 2.5;
    wobbleStrokeRect(ctx, insetX, insetY, insetW, insetH, borderRng, 2);

    // Site layout, in its own small grid, mapped into the inset's pixel
    // footprint.
    const gw = 22, gh = 17;
    const cellPx = Math.min((insetW - 16) / gw, (insetH - 16) / gh);
    const gridX = insetX + (insetW - cellPx * gw) / 2;
    const gridY = insetY + (insetH - cellPx * gh) / 2;
    const [roomMin, roomMax] = theme.roomCount;
    const roomCount = roomMin + Math.floor(siteRng() * (roomMax - roomMin + 1));
    const site = buildSiteLayout(siteRng, gw, gh, roomCount, theme);

    ctx.save();
    ctx.beginPath();
    ctx.rect(insetX + 2, insetY + 2, insetW - 4, insetH - 4);
    ctx.clip();

    for (let y = 0; y < gh; y++) {
      for (let x = 0; x < gw; x++) {
        if (site.grid[y][x] === 0) continue;
        ctx.fillStyle = site.grid[y][x] === 2 ? palette.biomes.plains : accentColor;
        ctx.globalAlpha = site.grid[y][x] === 2 ? 1 : 0.5;
        ctx.fillRect(gridX + x * cellPx, gridY + y * cellPx, cellPx, cellPx);
      }
    }
    ctx.globalAlpha = 1;
    ctx.strokeStyle = palette.ink;
    ctx.lineWidth = 1;
    for (let y = 0; y < gh; y++) {
      for (let x = 0; x < gw; x++) {
        if (site.grid[y][x] === 0) continue;
        wobbleStrokeRect(ctx, gridX + x * cellPx, gridY + y * cellPx, cellPx, cellPx, borderRng, Math.max(0.5, cellPx * 0.08));
      }
    }

    // Door ticks, same corridor-side detection as map-dungeon.js's own.
    for (let y = 0; y < gh; y++) {
      for (let x = 0; x < gw; x++) {
        if (site.grid[y][x] !== 2) continue;
        const px = gridX + x * cellPx, py = gridY + y * cellPx;
        const edges = [
          { nx: x + 1, ny: y, x1: px + cellPx, y1: py + cellPx * 0.2, x2: px + cellPx, y2: py + cellPx * 0.8 },
          { nx: x - 1, ny: y, x1: px, y1: py + cellPx * 0.2, x2: px, y2: py + cellPx * 0.8 },
          { nx: x, ny: y + 1, x1: px + cellPx * 0.2, y1: py + cellPx, x2: px + cellPx * 0.8, y2: py + cellPx },
          { nx: x, ny: y - 1, x1: px + cellPx * 0.2, y1: py, x2: px + cellPx * 0.8, y2: py },
        ];
        for (const e of edges) {
          if (e.nx < 0 || e.nx >= gw || e.ny < 0 || e.ny >= gh) continue;
          if (site.grid[e.ny][e.nx] !== 1) continue;
          ctx.strokeStyle = palette.ink;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(e.x1, e.y1);
          ctx.lineTo(e.x2, e.y2);
          ctx.stroke();
        }
      }
    }

    // Room purpose labels, plus the landmark's own icon at the heart room --
    // the same glyph the overworld itself draws for this landmark, so the
    // site map reads as a close-up of the exact thing that was clicked.
    ctx.font = '9px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = palette.ink;
    for (const room of site.rooms) {
      const rcx = gridX + (room.cx + 0.5) * cellPx, rcy = gridY + (room.cy + 0.5) * cellPx;
      if (room.isHeart) {
        drawWildZoneIcon(ctx, rcx, rcy - cellPx * 0.9, poiKey, palette.ink);
      }
      ctx.textBaseline = 'top';
      ctx.font = room.isHeart ? `bold 10px ${OW_SERIF}` : `9px ${OW_SERIF}`;
      ctx.fillText(room.purpose, rcx, rcy + cellPx * 0.6);
    }
    ctx.restore(); // clip

    ctx.font = `bold 14px ${OW_SERIF}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillStyle = palette.coastline;
    ctx.fillText(poiName, insetX + insetW / 2, insetY + 8);
    ctx.restore(); // inset alpha/style save

    // GM reference text -- plain DOM, not canvas (see the header comment
    // above); regenerated every call so switching themes doesn't leave
    // stale text, even though only the map's colors actually change.
    const lore = generateLandmarkLore(loreRng, poiKey);
    const loreEl = container.querySelector('#lm-lore');
    loreEl.innerHTML = `
      <h3>${poiLabel}</h3>
      <p class="lore-readaloud">${lore.readAloud}</p>
      ${lore.notableFeatures.length ? `<p class="lore-label">Notable features</p><ul>${lore.notableFeatures.map((f) => `<li>${f}</li>`).join('')}</ul>` : ''}
      ${lore.hazard ? `<p class="lore-label">Hazard</p><p>${lore.hazard}</p>` : ''}
      ${lore.treasureHook ? `<p class="lore-label">Treasure hook</p><p>${lore.treasureHook}</p>` : ''}
      ${lore.encounterHook ? `<p class="lore-label">Encounter hook</p><p>${lore.encounterHook}</p>` : ''}
    `;

    paintParchmentGrain(ctx, canvas, grainRng, palette.grain);
    drawCompassRose(ctx, canvas.width - 50, 50, 28, palette.coastline);
    drawMapVignetteAndBorder(ctx, canvas, palette.coastline, borderRng);
  }

  generate();
  container.querySelector('#lm-theme').addEventListener('change', generate);
  wireMapExportSave(container, canvas, 'lm', (offCtx) => {
    const prevCtx = ctx;
    ctx = offCtx;
    generate();
    ctx = prevCtx;
  });
}
