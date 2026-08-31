function populateCampaignSelect(selectEl) {
  Api.get('/api/campaigns').then((data) => {
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

function wireMapExportSave(container, canvas, prefix) {
  container.querySelector(`#${prefix}-export`).addEventListener('click', () => {
    const a = document.createElement('a');
    a.download = 'map.png';
    a.href = canvas.toDataURL('image/png');
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
      const res = await Api.post('/api/map/save-image', { campaign, filename, dataUrl: canvas.toDataURL('image/png') });
      statusEl.textContent = `Saved. Paste ${res.wikilink} into a note to link it.`;
    } catch (e) {
      statusEl.textContent = (e.data && e.data.error === 'file_exists') ? 'A file with that name already exists.' : 'Save failed.';
    }
  });
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

  const canvas = container.querySelector('#dg-canvas');
  const ctx = canvas.getContext('2d');

  function generate() {
    const seed = parseInt(container.querySelector('#dg-seed').value, 10) || 1;
    const gw = parseInt(container.querySelector('#dg-w').value, 10) || 60;
    const gh = parseInt(container.querySelector('#dg-h').value, 10) || 40;
    const minSize = parseInt(container.querySelector('#dg-min').value, 10) || 6;
    const maxDepth = parseInt(container.querySelector('#dg-depth').value, 10) || 5;
    const rng = mulberry32(seed);
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

    ctx.fillStyle = '#0e0e10';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    for (let y = 0; y < gh; y++) {
      for (let x = 0; x < gw; x++) {
        if (grid[y][x] === 1) ctx.fillStyle = '#caa96a';
        else if (grid[y][x] === 2) ctx.fillStyle = '#8a7a54';
        else continue;
        ctx.fillRect(x * cell, y * cell, cell, cell);
      }
    }
    ctx.strokeStyle = 'rgba(0,0,0,0.25)';
    ctx.lineWidth = 1;
    for (let y = 0; y < gh; y++) {
      for (let x = 0; x < gw; x++) {
        if (grid[y][x] !== 0) ctx.strokeRect(x * cell, y * cell, cell, cell);
      }
    }
  }

  generate();
  container.querySelector('#dg-regen').addEventListener('click', generate);
  wireMapExportSave(container, canvas, 'dg');
}
