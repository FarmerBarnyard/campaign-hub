function populateCampaignSelect(selectEl) {
  Api.get('/campaigns').then((data) => {
    selectEl.innerHTML = '';
    if (!data.campaigns.length) {
      const opt = document.createElement('option');
      opt.textContent = '(no campaigns yet)';
      opt.disabled = true;
      selectEl.appendChild(opt);
      return;
    }
    for (const c of data.campaigns) {
      const opt = document.createElement('option');
      opt.value = c.name;
      opt.textContent = c.name;
      selectEl.appendChild(opt);
    }
  }).catch(() => { });
}

// `renderAtScale` is optional: a callback `(offscreenCtx) => void` that a
// view supplies to redraw its *current* map onto whatever context it's
// given, at that context's own coordinate scale. Export/save then use it to
// render onto a 2x-larger offscreen canvas rather than upscaling the
// on-screen canvas's raster afterward -- lines, wobble strokes, and text all
// get genuinely redrawn at the higher pixel density (crisper when
// printed/zoomed) instead of just being stretched and blurred. Omitting it
// falls back to exporting the on-screen canvas exactly as before.
function wireMapExportSave(container, canvas, prefix, renderAtScale) {
  const EXPORT_SCALE = 2;

  function exportSource() {
    if (!renderAtScale) return canvas;
    const off = document.createElement('canvas');
    off.width = canvas.width * EXPORT_SCALE;
    off.height = canvas.height * EXPORT_SCALE;
    const offCtx = off.getContext('2d');
    offCtx.scale(EXPORT_SCALE, EXPORT_SCALE);
    renderAtScale(offCtx);
    return off;
  }

  container.querySelector(`#${prefix}-export`).addEventListener('click', () => {
    const a = document.createElement('a');
    a.download = 'map.png';
    a.href = exportSource().toDataURL('image/png');
    a.click();
  });

  container.querySelector(`#${prefix}-save`).addEventListener('click', async () => {
    const statusEl = container.querySelector(`#${prefix}-status`);
    const campaign = container.querySelector(`#${prefix}-campaign`).value;
    let filename = container.querySelector(`#${prefix}-filename`).value.trim();
    if (!filename) filename = `map-${Date.now()}.png`;
    if (!filename.endsWith('.png')) filename += '.png';
    if (!campaign) { statusEl.textContent = 'No campaign selected — create one in the Library first.'; return; }
    try {
      const res = await Api.post('/map/save-image', { campaign, filename, dataUrl: exportSource().toDataURL('image/png') });
      statusEl.textContent = `Saved. Paste ${res.wikilink} into a note to link it.`;
    } catch (e) {
      if (e.code === 'unauthenticated') {
        statusEl.textContent = 'You need to be logged in to save maps. Log in (top of page) and try again.';
      } else if (e.code === 'forbidden') {
        statusEl.textContent = "You're logged in, but don't have access to save maps.";
      } else {
        statusEl.textContent = (e.data && e.data.error === 'file_exists') ? 'A file with that name already exists.' : 'Save failed.';
      }
    }
  });
}

// wobbleStrokeRect/carveCircleRoom/carveOctagonRoom/carveLShapeRoom/
// carveCrossRoom/carveCaveRoom/findRoomDoorways/drawTrapGlyph/carveCorridor
// now live in lib/room-shapes.js -- factored out so views/map-landmark.js's
// smaller site-layout generator can reuse the exact same carving math
// instead of a second, potentially-drifting copy. Loaded as a global script
// like everything else here, so every call site below is unchanged.

// Small legend card documenting the door/secret-door/trap symbols. Room
// purpose/flavor content lives in the .dungeon-key DOM panel below the
// canvas (see assignDungeonRoomContent in lib/dungeon-lore.js) rather than
// here -- this card stays focused on iconography, there's no room to list
// up to ~20 room entries in a fixed-size on-canvas box.
function drawDungeonLegend(ctx, canvas, palette) {
  const padding = 10, rowH = 15, swatchSize = 11;
  const boxWidth = 150;
  const boxHeight = 3 * rowH + padding * 2 + 22;
  const boxX = padding, boxY = canvas.height - boxHeight - padding;

  ctx.save();
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.fillRect(boxX, boxY, boxWidth, boxHeight);
  ctx.strokeStyle = 'rgba(0,0,0,0.3)';
  ctx.lineWidth = 1;
  ctx.strokeRect(boxX, boxY, boxWidth, boxHeight);

  ctx.font = '10px sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  const iconX = boxX + padding + swatchSize / 2;

  let rowY = boxY + padding + rowH / 2;
  ctx.strokeStyle = palette.door;
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(iconX - swatchSize / 2, rowY); ctx.lineTo(iconX + swatchSize / 2, rowY); ctx.stroke();
  ctx.fillStyle = '#1a1a1a';
  ctx.fillText('Door', boxX + padding + swatchSize + 6, rowY);

  rowY += rowH;
  ctx.strokeStyle = palette.secretDoor;
  ctx.setLineDash([2, 2]);
  ctx.beginPath(); ctx.moveTo(iconX - swatchSize / 2, rowY); ctx.lineTo(iconX + swatchSize / 2, rowY); ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = '#1a1a1a';
  ctx.fillText('Secret door', boxX + padding + swatchSize + 6, rowY);

  rowY += rowH;
  drawTrapGlyph(ctx, iconX, rowY, swatchSize * 0.35, palette.trapMark);
  ctx.fillStyle = '#1a1a1a';
  ctx.fillText('Trap', boxX + padding + swatchSize + 6, rowY);

  rowY += rowH + 6;
  ctx.font = '9px sans-serif';
  ctx.fillStyle = '#444444';
  ctx.fillText('Rooms numbered -- see', boxX + padding, rowY);
  ctx.fillText('room key below the map.', boxX + padding, rowY + 11);
  ctx.restore();
}

// Dungeon/battle map: BSP tree. Chosen over cellular automata because it
// guarantees connectivity by construction (every split node wires its two
// children together) with grid-aligned rooms suited to 5-ft-square D&D maps.
function renderDungeonMap(container) {
  container.innerHTML = `
    <h2>Dungeon map generator</h2>
    <div class="map-layout">
      <div class="map-controls">
        <label>Seed <input id="dg-seed" type="number" value="${Math.floor(Math.random() * 1e6)}"></label>
        <label>Theme <select id="dg-theme"></select></label>
        <label>Grid width (cells) <input id="dg-w" type="number" value="60"></label>
        <label>Grid height (cells) <input id="dg-h" type="number" value="40"></label>
        <label>Min room size <input id="dg-min" type="number" value="6"></label>
        <label>Max split depth <input id="dg-depth" type="number" value="5" min="1" max="8"></label>
        <label><input id="dg-legend" type="checkbox"> Show legend</label>
        <button id="dg-regen">Regenerate</button>
        <hr>
        <button id="dg-export">Export PNG</button>
        <label>Save as <input id="dg-filename" placeholder="filename.png" autocomplete="off"></label>
        <label>Campaign <select id="dg-campaign"></select></label>
        <button id="dg-save">Save to campaign</button>
        <p id="dg-status" class="status-text"></p>
      </div>
      <canvas id="dg-canvas" width="900" height="600"></canvas>
    </div>
    <div class="dungeon-key" id="dg-key"></div>
  `;

  populateCampaignSelect(container.querySelector('#dg-campaign'));
  populateThemeSelect(container.querySelector('#dg-theme'));

  const canvas = container.querySelector('#dg-canvas');
  // `let`, not `const` -- wireMapExportSave's high-res export temporarily
  // points this at an offscreen context so the exact same generate() logic
  // redraws there instead of the on-screen canvas, then restores it.
  let ctx = canvas.getContext('2d');

  function generate() {
    const seed = parseInt(container.querySelector('#dg-seed').value, 10) || 1;
    const gw = parseInt(container.querySelector('#dg-w').value, 10) || 60;
    const gh = parseInt(container.querySelector('#dg-h').value, 10) || 40;
    const minSize = parseInt(container.querySelector('#dg-min').value, 10) || 6;
    const maxDepth = parseInt(container.querySelector('#dg-depth').value, 10) || 5;
    const theme = MAP_THEMES[container.querySelector('#dg-theme').value] || MAP_THEMES[MAP_THEME_DEFAULT];
    const palette = theme.dungeon;
    const rng = mulberry32(seed);
    // Separate rngs for the two cosmetic-only passes (wobble jitter, rubble
    // texture), seeded off the same seed but never consumed by layout
    // generation -- switching themes must never perturb the room/corridor
    // layout itself, and adding rubble must never shift where the wobble
    // jitter lands.
    const wobbleRng = mulberry32(seed + 991);
    const debrisRng = mulberry32(seed + 44444);
    // Dedicated rngs for the published-module-style polish pass -- room
    // shape rolls, door/secret-door rolls, trap placement, and set-piece
    // selection each get their own stream so toggling/regenerating any one
    // of them never perturbs the underlying room/corridor layout or each
    // other.
    const shapeRng = mulberry32(seed + 66666);
    const doorRng = mulberry32(seed + 88888);
    const trapRng = mulberry32(seed + 13131);
    const setpieceRng = mulberry32(seed + 24680);
    // Content (purpose/flavor text) and prop placement each get their own
    // stream too, same isolation convention -- assigning room content or
    // scattering props must never perturb the layout/shape/door/trap rolls
    // above, or each other.
    const contentRng = mulberry32(seed + 36912);
    const propRng = mulberry32(seed + 75318);
    const legendOn = container.querySelector('#dg-legend').checked;
    const cell = Math.min(canvas.width / gw, canvas.height / gh);

    // 0 = rock, 1 = room, 2 = corridor
    const grid = [];
    for (let y = 0; y < gh; y++) grid.push(new Array(gw).fill(0));
    const rooms = [];

    function split(rx, ry, rw, rh, depth) {
      if (depth >= maxDepth || rw < minSize * 2 || rh < minSize * 2) {
        const pad = 1 + Math.floor(rng() * 2);
        const rmX = rx + pad, rmY = ry + pad;
        const rmW = Math.max(3, rw - pad * 2 - Math.floor(rng() * 2));
        const rmH = Math.max(3, rh - pad * 2 - Math.floor(rng() * 2));
        for (let y = rmY; y < Math.min(gh, rmY + rmH); y++) {
          for (let x = rmX; x < Math.min(gw, rmX + rmW); x++) grid[y][x] = 1;
        }
        const roomCx = rmX + Math.floor(rmW / 2), roomCy = rmY + Math.floor(rmH / 2);
        rooms.push({ rx: rmX, ry: rmY, rw: Math.min(rmW, gw - rmX), rh: Math.min(rmH, gh - rmY), cx: roomCx, cy: roomCy, shape: 'rect' });
        return { cx: roomCx, cy: roomCy };
      }
      const splitHoriz = rw < rh || (rw === rh && rng() < 0.5);
      let a, b;
      if (splitHoriz) {
        const cut = Math.max(1, Math.floor(rh * (0.4 + rng() * 0.2)));
        a = split(rx, ry, rw, cut, depth + 1);
        b = split(rx, ry + cut, rw, rh - cut, depth + 1);
      } else {
        const cut = Math.max(1, Math.floor(rw * (0.4 + rng() * 0.2)));
        a = split(rx, ry, cut, rh, depth + 1);
        b = split(rx + cut, ry, rw - cut, rh, depth + 1);
      }
      carveCorridor(grid, a, b);
      return rng() < 0.5 ? a : b;
    }

    split(0, 0, gw, gh, 0);

    // Room-shape variety: most rooms stay plain rectangles (the safest
    // shape for tactical grid combat), but a minority roll into a distinct
    // shape. Re-carving is safe regardless of order because corridors never
    // occupy a cell inside a room's rectangle in the first place (see the
    // carving functions' own comment), and every shape guarantees the
    // room's (cx,cy) corridor-connection point stays floor.
    rooms.forEach((room) => {
      if (room.rw < 6 || room.rh < 6) return;
      const roll = shapeRng();
      if (roll < 0.12) room.shape = 'circle';
      else if (roll < 0.22) room.shape = 'octagon';
      else if (roll < 0.32) room.shape = 'lshape';
      else if (roll < 0.40) room.shape = 'cave';
    });

    // Occasional set-piece: the single largest room gets a shot at becoming
    // a memorable arena/cathedral chamber, overriding whatever it rolled
    // above -- a published module's "boss room" moment.
    if (rooms.length > 0) {
      let largest = rooms[0];
      for (const room of rooms) { if (room.rw * room.rh > largest.rw * largest.rh) largest = room; }
      if (largest.rw >= 8 && largest.rh >= 8 && setpieceRng() < 0.4) {
        largest.shape = setpieceRng() < 0.5 ? 'arena' : 'cathedral';
      }
    }

    rooms.forEach((room, idx) => {
      room.number = idx + 1;
      if (room.shape === 'rect') return;
      // A corridor's straight-line walk can enter this room's rectangle
      // anywhere along its edge, not necessarily near (cx,cy) -- record
      // every such doorway *before* clearing, since a non-rect shape can
      // easily clip away the exact cell a corridor used to enter through.
      const doorways = findRoomDoorways(grid, gw, gh, room);
      for (let y = room.ry; y < room.ry + room.rh; y++) {
        for (let x = room.rx; x < room.rx + room.rw; x++) {
          if (y >= 0 && y < gh && x >= 0 && x < gw) grid[y][x] = 0;
        }
      }
      if (room.shape === 'circle' || room.shape === 'arena') carveCircleRoom(grid, room.rx, room.ry, room.rw, room.rh);
      else if (room.shape === 'octagon') carveOctagonRoom(grid, room.rx, room.ry, room.rw, room.rh);
      else if (room.shape === 'lshape') carveLShapeRoom(grid, room.rx, room.ry, room.rw, room.rh, shapeRng);
      else if (room.shape === 'cave') carveCaveRoom(grid, gw, gh, room.rx, room.ry, room.rw, room.rh, room.cx, room.cy, shapeRng);
      else if (room.shape === 'cathedral') carveCrossRoom(grid, room.rx, room.ry, room.rw, room.rh);
      // Defensive: every carve function above already includes the
      // connection point by construction, but this is a cheap, harmless
      // guarantee against a corridor ever being severed.
      if (room.cy >= 0 && room.cy < gh && room.cx >= 0 && room.cx < gw) grid[room.cy][room.cx] = 1;
      // Reconnect every original doorway to the room's new shape with a
      // short straight stub -- guarantees every corridor that used to
      // reach this room still can, regardless of what the new shape kept.
      for (const d of doorways) {
        let x = d.x, y = d.y;
        if (y >= 0 && y < gh && x >= 0 && x < gw) grid[y][x] = 1;
        while (x !== room.cx) {
          x += x < room.cx ? 1 : -1;
          if (y >= 0 && y < gh && x >= 0 && x < gw && grid[y][x] === 0) grid[y][x] = 1;
        }
        while (y !== room.cy) {
          y += y < room.cy ? 1 : -1;
          if (y >= 0 && y < gh && x >= 0 && x < gw && grid[y][x] === 0) grid[y][x] = 1;
        }
      }
    });

    // Purpose label + flavor line per room, drawn without replacement from
    // a flat pool until exhausted then reshuffled -- see lib/dungeon-lore.js.
    // Rendered below in the .dungeon-key DOM panel, not on-canvas (no room
    // for ~20 room entries in the fixed-size legend card).
    assignDungeonRoomContent(rooms, contentRng);

    ctx.fillStyle = palette.rock;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Organic floor-plan rendering: grid[y][x] (0=rock/1=room/2=corridor)
    // is exactly the regular grid lib/terrain-grid.js's extractFillableRegions
    // already expects (cols=gw, rows=gh, cellW=cellH=cell) -- Chaikin-smooth
    // the resulting contours instead of filling literal per-cell squares,
    // which is what read as a CAD floor plan. Two passes, not one merged
    // fill: rooms are a strict subset of the floor, so painting the room
    // contour over an already-smoothed corridor base can never create a
    // seam/gap at a doorway (it just reads as a smooth-cornered shape
    // sitting inside the corridor color) -- independently smoothing room
    // and corridor contours to match at their shared boundary would risk
    // exactly that seam. Pure rendering change: the BSP algorithm and
    // connectivity guarantee above are completely untouched.
    const minLoopArea = cell * cell * 0.5;
    const floorLoops = smoothFillLoops(extractFillableRegions(gw, gh, cell, cell,
      (i) => (grid[Math.floor(i / gw)][i % gw] !== 0 ? 1 : 0), 0.5, canvas.width, canvas.height, minLoopArea), 2);
    const roomLoops = smoothFillLoops(extractFillableRegions(gw, gh, cell, cell,
      (i) => (grid[Math.floor(i / gw)][i % gw] === 1 ? 1 : 0), 0.5, canvas.width, canvas.height, minLoopArea), 2);
    function pathFromDungeonLoops(loops) {
      ctx.beginPath();
      for (const loop of loops) {
        if (loop.length === 0) continue;
        ctx.moveTo(loop[0].x, loop[0].y);
        for (let i = 1; i < loop.length; i++) ctx.lineTo(loop[i].x, loop[i].y);
        ctx.closePath();
      }
    }
    function fillDungeonLoops(loops, fillStyle) {
      if (loops.length === 0) return;
      ctx.fillStyle = fillStyle;
      pathFromDungeonLoops(loops);
      ctx.fill('evenodd');
    }
    fillDungeonLoops(floorLoops, palette.corridor);
    fillDungeonLoops(roomLoops, palette.room);

    // Outline: a themed double-stroke ink wash (wide low-alpha + thin
    // crisp, same technique map-detail.js's coastline uses) reads as
    // hand-inked for "wobble" themes; grim/modern themes keep a single
    // crisp line. Per-point jitter (the old wobbleStrokeRect treatment)
    // doesn't apply cleanly to an already-smoothed contour, so wobbleRng
    // instead varies each loop's wash width/alpha slightly for organic
    // variation loop-to-loop.
    ctx.lineJoin = 'round';
    function strokeDungeonLoops(loops) {
      for (const loop of loops) {
        if (loop.length === 0) continue;
        ctx.beginPath();
        ctx.moveTo(loop[0].x, loop[0].y);
        for (let i = 1; i < loop.length; i++) ctx.lineTo(loop[i].x, loop[i].y);
        ctx.closePath();
        ctx.strokeStyle = palette.stroke;
        if (palette.wobble) {
          ctx.globalAlpha = 0.3 + wobbleRng() * 0.15;
          ctx.lineWidth = cell * (0.16 + wobbleRng() * 0.08);
          ctx.stroke();
          ctx.globalAlpha = 1;
        }
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }
    strokeDungeonLoops(floorLoops);
    strokeDungeonLoops(roomLoops);

    // Light rubble/debris texture inside rooms (not corridors) -- a sparse
    // scatter of small dots, gated by probability so it reads as clutter
    // rather than a solid carpet, matching paintBiomeTexture's convention
    // on the overworld map. Its own dedicated rng stream means toggling
    // this never perturbs the room/corridor layout above.
    ctx.fillStyle = palette.stroke;
    for (let y = 0; y < gh; y++) {
      for (let x = 0; x < gw; x++) {
        if (grid[y][x] !== 1) continue;
        if (debrisRng() > 0.12) continue;
        const px = x * cell + cell * (0.3 + debrisRng() * 0.4);
        const py = y * cell + cell * (0.3 + debrisRng() * 0.4);
        const size = Math.max(0.6, cell * 0.06);
        ctx.globalAlpha = 0.3;
        ctx.beginPath();
        ctx.arc(px, py, size, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      }
    }

    // Prop glyphs: a sparser, coarser, per-room pass (not per-cell like
    // debris above) -- crates/barrels/bones/etc., lightly correlated with
    // each room's purpose (see lib/dungeon-props.js). Additive on top of
    // the debris scatter, own rng stream, so it never perturbs debris
    // placement or the layout.
    scatterDungeonProps(ctx, grid, gw, gh, rooms, cell, propRng, palette);

    // Room numbers -- content (purpose/flavor) lives in the .dungeon-key
    // DOM panel below the map, keyed by this same number.
    ctx.font = '9px sans-serif';
    ctx.fillStyle = palette.door;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const room of rooms) {
      ctx.fillText(String(room.number), room.cx * cell + cell / 2, room.cy * cell + cell / 2);
    }

    // Door / secret-door ticks: found from each corridor cell's own
    // perspective (checking its 4 neighbors for a room), so each boundary
    // is drawn exactly once regardless of how many corridor cells border
    // that room. A small per-door roll renders it as a dashed secret door
    // instead of a normal one.
    for (let y = 0; y < gh; y++) {
      for (let x = 0; x < gw; x++) {
        if (grid[y][x] !== 2) continue;
        const edges = [
          { nx: x + 1, ny: y, x1: (x + 1) * cell, y1: y * cell + cell * 0.2, x2: (x + 1) * cell, y2: y * cell + cell * 0.8 },
          { nx: x - 1, ny: y, x1: x * cell, y1: y * cell + cell * 0.2, x2: x * cell, y2: y * cell + cell * 0.8 },
          { nx: x, ny: y + 1, x1: x * cell + cell * 0.2, y1: (y + 1) * cell, x2: x * cell + cell * 0.8, y2: (y + 1) * cell },
          { nx: x, ny: y - 1, x1: x * cell + cell * 0.2, y1: y * cell, x2: x * cell + cell * 0.8, y2: y * cell },
        ];
        for (const e of edges) {
          if (e.nx < 0 || e.nx >= gw || e.ny < 0 || e.ny >= gh) continue;
          if (grid[e.ny][e.nx] !== 1) continue;
          const isSecret = doorRng() < 0.15;
          ctx.strokeStyle = isSecret ? palette.secretDoor : palette.door;
          ctx.lineWidth = 2;
          ctx.setLineDash(isSecret ? [2, 2] : []);
          ctx.beginPath();
          ctx.moveTo(e.x1, e.y1);
          ctx.lineTo(e.x2, e.y2);
          ctx.stroke();
          ctx.setLineDash([]);
        }
      }
    }

    // Trap markers: sparse, corridor-only, purely informational glyphs --
    // matching the "icon, not simulation" pattern paintBiomeTexture already
    // uses on the overworld map.
    for (let y = 0; y < gh; y++) {
      for (let x = 0; x < gw; x++) {
        if (grid[y][x] !== 2) continue;
        if (trapRng() > 0.02) continue;
        drawTrapGlyph(ctx, x * cell + cell / 2, y * cell + cell / 2, cell * 0.18, palette.trapMark);
      }
    }

    if (legendOn) drawDungeonLegend(ctx, canvas, palette);

    // Room key: plain DOM text below the canvas, not part of the PNG export
    // (matches every other generator's "canvas is the export unit"
    // convention -- see views/map-landmark.js's .landmark-lore). Regenerated
    // every call so a theme switch never leaves stale entries, even though
    // theme switches don't actually change room content.
    const keyEl = container.querySelector('#dg-key');
    const sortedRooms = rooms.slice().sort((a, b) => a.number - b.number);
    keyEl.innerHTML = `<h3>Room key</h3>` + sortedRooms.map((r) =>
      `<p class="key-room"><span class="key-room-num">${r.number}</span> <strong>${r.purpose}</strong><br>${r.flavor}</p>`
    ).join('');
  }

  generate();
  container.querySelector('#dg-regen').addEventListener('click', generate);
  container.querySelector('#dg-theme').addEventListener('change', generate);
  wireMapExportSave(container, canvas, 'dg', (offCtx) => {
    const prevCtx = ctx;
    ctx = offCtx;
    generate();
    ctx = prevCtx;
  });
}
