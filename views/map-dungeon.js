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
    const cell = Math.min(canvas.width / gw, canvas.height / gh);

    // 0 = rock, 1 = room, 2 = corridor
    const grid = [];
    for (let y = 0; y < gh; y++) grid.push(new Array(gw).fill(0));

    function split(rx, ry, rw, rh, depth) {
      if (depth >= maxDepth || rw < minSize * 2 || rh < minSize * 2) {
        const pad = 1 + Math.floor(rng() * 2);
        const rmX = rx + pad, rmY = ry + pad;
        const rmW = Math.max(3, rw - pad * 2 - Math.floor(rng() * 2));
        const rmH = Math.max(3, rh - pad * 2 - Math.floor(rng() * 2));
        for (let y = rmY; y < Math.min(gh, rmY + rmH); y++) {
          for (let x = rmX; x < Math.min(gw, rmX + rmW); x++) grid[y][x] = 1;
        }
        return { cx: rmX + Math.floor(rmW / 2), cy: rmY + Math.floor(rmH / 2) };
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
