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

// Draws a rectangle's outline as four jittered line segments instead of a
// perfectly straight strokeRect -- reads as sketchy/hand-inked rather than
// CAD-precise. Jitter is driven by the caller's rng, so it's part of the
// same seeded sequence and reproduces identically for a given seed.
function wobbleStrokeRect(ctx, x, y, w, h, rng, jitter) {
  const j = () => (rng() - 0.5) * jitter;
  const corners = [
    [x + j(), y + j()],
    [x + w + j(), y + j()],
    [x + w + j(), y + h + j()],
    [x + j(), y + h + j()],
  ];
  ctx.beginPath();
  ctx.moveTo(corners[0][0], corners[0][1]);
  for (let i = 1; i <= 4; i++) {
    const c = corners[i % 4];
    ctx.lineTo(c[0], c[1]);
  }
  ctx.stroke();
}

// Room-shape carving for the published-module-style variety pass. Each
// function fills a subset of the room's rectangular footprint (rx,ry,rw,rh)
// -- never anything outside it -- so re-carving a room this way is always
// safe: a corridor never touches a cell inside a room's rectangle in the
// first place (carveCorridor's `if grid===0` guard already keeps rooms and
// corridors mutually exclusive), and every shape below guarantees the
// room's own (cx,cy) connection point stays floor, so clearing the
// rectangle and re-carving a smaller shape can never sever a corridor.

function carveCircleRoom(grid, rx, ry, rw, rh) {
  const cx = rx + rw / 2, cy = ry + rh / 2;
  const a = rw / 2, b = rh / 2;
  for (let y = ry; y < ry + rh; y++) {
    for (let x = rx; x < rx + rw; x++) {
      const dx = (x + 0.5 - cx) / a, dy = (y + 0.5 - cy) / b;
      if (dx * dx + dy * dy <= 1) grid[y][x] = 1;
    }
  }
}

function carveOctagonRoom(grid, rx, ry, rw, rh) {
  const cut = Math.min(rw, rh) * 0.3;
  for (let y = ry; y < ry + rh; y++) {
    for (let x = rx; x < rx + rw; x++) {
      const lx = x - rx, ly = y - ry;
      const corners = [
        [lx, ly], [rw - 1 - lx, ly], [lx, rh - 1 - ly], [rw - 1 - lx, rh - 1 - ly],
      ];
      let clipped = false;
      for (const [d1, d2] of corners) {
        if (d1 < cut && d2 < cut && d1 + d2 < cut) clipped = true;
      }
      if (!clipped) grid[y][x] = 1;
    }
  }
}

// Full rectangle with one corner notched out -- simpler to get right than
// unioning two sub-rectangles, and reads the same on a grid.
function carveLShapeRoom(grid, rx, ry, rw, rh, rng) {
  for (let y = ry; y < ry + rh; y++) for (let x = rx; x < rx + rw; x++) grid[y][x] = 1;
  const notchW = Math.floor(rw * 0.45), notchH = Math.floor(rh * 0.45);
  const corner = Math.floor(rng() * 4);
  const nx = corner % 2 === 0 ? rx : rx + rw - notchW;
  const ny = corner < 2 ? ry : ry + rh - notchH;
  for (let y = ny; y < ny + notchH; y++) {
    for (let x = nx; x < nx + notchW; x++) grid[y][x] = 0;
  }
}

// A plus/cross footprint -- reads as a cathedral-style chamber, used for
// the occasional set-piece room rather than ordinary rooms.
function carveCrossRoom(grid, rx, ry, rw, rh) {
  const armW = Math.max(2, Math.floor(rw * 0.4));
  const armH = Math.max(2, Math.floor(rh * 0.4));
  const vx = rx + Math.floor((rw - armW) / 2);
  for (let y = ry; y < ry + rh; y++) for (let x = vx; x < vx + armW; x++) grid[y][x] = 1;
  const hy = ry + Math.floor((rh - armH) / 2);
  for (let y = hy; y < hy + armH; y++) for (let x = rx; x < rx + rw; x++) grid[y][x] = 1;
}

// Cellular-automata cave pocket, bounded strictly within the room's
// rectangle. A few smoothing passes over a noisy initial fill, then a
// flood-fill from the room's own connection point keeps only the reachable
// floor -- guaranteeing the result is a single connected blob that still
// includes (cx,cy), however the CA noise happened to fall.
function carveCaveRoom(grid, gw, gh, rx, ry, rw, rh, cx, cy, rng) {
  const local = [];
  for (let y = 0; y < rh; y++) local.push(new Array(rw).fill(0));
  for (let y = 1; y < rh - 1; y++) {
    for (let x = 1; x < rw - 1; x++) local[y][x] = rng() < 0.55 ? 1 : 0;
  }
  for (let iter = 0; iter < 3; iter++) {
    const next = local.map((row) => row.slice());
    for (let y = 1; y < rh - 1; y++) {
      for (let x = 1; x < rw - 1; x++) {
        let n = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            const nx = x + dx, ny = y + dy;
            n += (nx < 0 || ny < 0 || nx >= rw || ny >= rh) ? 1 : local[ny][nx];
          }
        }
        next[y][x] = n >= 5 ? 1 : (n <= 3 ? 0 : local[y][x]);
      }
    }
    for (let y = 0; y < rh; y++) for (let x = 0; x < rw; x++) local[y][x] = next[y][x];
  }

  const lcx = Math.max(1, Math.min(rw - 2, cx - rx));
  const lcy = Math.max(1, Math.min(rh - 2, cy - ry));
  local[lcy][lcx] = 1;
  const keep = local.map((row) => row.map(() => false));
  const stack = [[lcx, lcy]];
  keep[lcy][lcx] = true;
  while (stack.length) {
    const [x, y] = stack.pop();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= rw || ny >= rh) continue;
      if (keep[ny][nx] || !local[ny][nx]) continue;
      keep[ny][nx] = true;
      stack.push([nx, ny]);
    }
  }
  for (let y = 0; y < rh; y++) {
    for (let x = 0; x < rw; x++) {
      if (keep[y][x] && ry + y < gh && rx + x < gw) grid[ry + y][rx + x] = 1;
    }
  }
}

// A corridor's straight-line walk can enter a room's rectangle anywhere
// along its edge -- not necessarily near the room's center -- so before
// re-carving a room to a smaller shape, every such entry point needs to be
// found and explicitly reconnected afterward (see the call site below).
// Only the rectangle's boundary can border a corridor at all (corridors
// never occupy a cell inside a room's rectangle), so scanning just the
// perimeter is sufficient.
function findRoomDoorways(grid, gw, gh, room) {
  const doorways = [];
  for (let x = room.rx; x < room.rx + room.rw; x++) {
    if (room.ry - 1 >= 0 && grid[room.ry - 1][x] === 2) doorways.push({ x, y: room.ry });
    const by = room.ry + room.rh - 1;
    if (by + 1 < gh && grid[by + 1][x] === 2) doorways.push({ x, y: by });
  }
  for (let y = room.ry; y < room.ry + room.rh; y++) {
    if (room.rx - 1 >= 0 && grid[y][room.rx - 1] === 2) doorways.push({ x: room.rx, y });
    const bx = room.rx + room.rw - 1;
    if (bx + 1 < gw && grid[y][bx + 1] === 2) doorways.push({ x: bx, y });
  }
  return doorways;
}

function drawTrapGlyph(ctx, cx, cy, size, color) {
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(cx - size, cy - size); ctx.lineTo(cx + size, cy + size);
  ctx.moveTo(cx + size, cy - size); ctx.lineTo(cx - size, cy + size);
  ctx.stroke();
}

// Small legend card documenting the door/secret-door/trap symbols -- v1 is
// numbers-only for rooms themselves (no auto-generated room content), so
// the legend explains the map's iconography rather than listing contents.
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
  ctx.fillText('Rooms numbered -- key', boxX + padding, rowY);
  ctx.fillText('your own notes to them.', boxX + padding, rowY + 11);
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
      carveCorridor(a, b);
      return rng() < 0.5 ? a : b;
    }

    function carveCorridor(a, b) {
      let x = a.cx, y = a.cy;
      while (x !== b.cx) {
        if (grid[y][x] === 0) grid[y][x] = 2;
        x += x < b.cx ? 1 : -1;
      }
      while (y !== b.cy) {
        if (grid[y][x] === 0) grid[y][x] = 2;
        y += y < b.cy ? 1 : -1;
      }
      if (grid[y][x] === 0) grid[y][x] = 2;
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

    ctx.fillStyle = palette.rock;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    for (let y = 0; y < gh; y++) {
      for (let x = 0; x < gw; x++) {
        if (grid[y][x] === 1) ctx.fillStyle = palette.room;
        else if (grid[y][x] === 2) ctx.fillStyle = palette.corridor;
        else continue;
        ctx.fillRect(x * cell, y * cell, cell, cell);
      }
    }
    ctx.strokeStyle = palette.stroke;
    ctx.lineWidth = 1;
    for (let y = 0; y < gh; y++) {
      for (let x = 0; x < gw; x++) {
        if (grid[y][x] === 0) continue;
        if (palette.wobble) {
          wobbleStrokeRect(ctx, x * cell, y * cell, cell, cell, wobbleRng, Math.max(1, cell * 0.08));
        } else {
          ctx.strokeRect(x * cell, y * cell, cell, cell);
        }
      }
    }

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

    // Room numbers -- v1 is numbers-only (no auto-generated room content);
    // a legend/key note is the on-canvas legend below, actual descriptions
    // are left to the player's own linked notes.
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
