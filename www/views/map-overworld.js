const BIOME_COLORS = {
  deepwater: '#1b3a5c',
  shallowwater: '#2f6690',
  beach: '#d9c98d',
  plains: '#7fa653',
  forest: '#3f6b3a',
  hills: '#8a7a54',
  mountains: '#6b6b6b',
  snow: '#eef2f5',
};

function biomeAt(h, moist, seaLevel) {
  if (h < seaLevel - 0.08) return 'deepwater';
  if (h < seaLevel) return 'shallowwater';
  if (h < seaLevel + 0.03) return 'beach';
  if (h > 0.85) return 'snow';
  if (h > 0.7) return 'mountains';
  if (h > 0.55) return 'hills';
  if (moist > 0.5) return 'forest';
  return 'plains';
}

// Overworld/region map: value-noise heightmap (fbm), biome bands, settlements
// placed by scoring settleable cells with a min-distance filter, roads via a
// nearest-neighbor MST approximation.
function renderOverworldMap(container) {
  container.innerHTML = `
    <h2>Overworld map generator</h2>
    <div class="map-layout">
      <div class="map-controls">
        <label>Seed <input id="ow-seed" type="number" value="${Math.floor(Math.random() * 1e6)}"></label>
        <label>Width (cells) <input id="ow-w" type="number" value="80"></label>
        <label>Height (cells) <input id="ow-h" type="number" value="60"></label>
        <label>Octaves <input id="ow-oct" type="number" value="4" min="1" max="6"></label>
        <label>Sea level <input id="ow-sea" type="range" min="0" max="100" value="42"></label>
        <label><input id="ow-island" type="checkbox" checked> Island mode</label>
        <label>Settlements <input id="ow-settle" type="number" value="6" min="0" max="20"></label>
        <button id="ow-regen">Regenerate</button>
        <hr>
        <button id="ow-export">Export PNG</button>
        <label>Save as <input id="ow-filename" placeholder="filename.png" autocomplete="off"></label>
        <label>Campaign <select id="ow-campaign"></select></label>
        <button id="ow-save">Save to campaign</button>
        <p id="ow-status" class="status-text"></p>
      </div>
      <canvas id="ow-canvas" width="800" height="600"></canvas>
    </div>
  `;

  populateCampaignSelect(container.querySelector('#ow-campaign'));

  const canvas = container.querySelector('#ow-canvas');
  const ctx = canvas.getContext('2d');

  function generate() {
    const seed = parseInt(container.querySelector('#ow-seed').value, 10) || 1;
    const gw = parseInt(container.querySelector('#ow-w').value, 10) || 80;
    const gh = parseInt(container.querySelector('#ow-h').value, 10) || 60;
    const octaves = parseInt(container.querySelector('#ow-oct').value, 10) || 4;
    const seaLevel = parseInt(container.querySelector('#ow-sea').value, 10) / 100;
    const island = container.querySelector('#ow-island').checked;
    const settleCount = parseInt(container.querySelector('#ow-settle').value, 10) || 0;

    const rng = mulberry32(seed);
    const height = fbm(rng, gw, gh, octaves);
    const moisture = fbm(mulberry32(seed + 99991), gw, gh, Math.max(1, octaves - 1));

    if (island) {
      const cx = gw / 2, cy = gh / 2;
      const maxD = Math.sqrt(cx * cx + cy * cy);
      for (let y = 0; y < gh; y++) {
        for (let x = 0; x < gw; x++) {
          const d = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2) / maxD;
          height[y][x] *= Math.max(0, 1 - d * d * 1.3);
        }
      }
    }

    const cellW = canvas.width / gw, cellH = canvas.height / gh;
    const biomes = [];
    for (let y = 0; y < gh; y++) {
      const row = [];
      for (let x = 0; x < gw; x++) {
        const b = biomeAt(height[y][x], moisture[y][x], seaLevel);
        row.push(b);
        ctx.fillStyle = BIOME_COLORS[b];
        ctx.fillRect(x * cellW, y * cellH, cellW + 1, cellH + 1);
      }
      biomes.push(row);
    }

    const candidates = [];
    for (let y = 1; y < gh - 1; y++) {
      for (let x = 1; x < gw - 1; x++) {
        const b = biomes[y][x];
        if (b === 'plains' || b === 'beach' || b === 'hills') {
          candidates.push({ x, y, score: rng() + (b === 'plains' ? 0.3 : 0) });
        }
      }
    }
    candidates.sort((a, b) => b.score - a.score);
    const minDist = Math.max(gw, gh) / (settleCount + 1) * 0.6;
    const settlements = [];
    for (const c of candidates) {
      if (settlements.length >= settleCount) break;
      if (settlements.every((s) => Math.hypot(s.x - c.x, s.y - c.y) >= minDist)) {
        settlements.push(c);
      }
    }

    ctx.strokeStyle = 'rgba(90,70,40,0.85)';
    ctx.lineWidth = 2;
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
        ctx.beginPath();
        ctx.moveTo(a.x * cellW, a.y * cellH);
        const midX = (a.x + b.x) / 2 + (rng() - 0.5) * 4;
        const midY = (a.y + b.y) / 2 + (rng() - 0.5) * 4;
        ctx.quadraticCurveTo(midX * cellW, midY * cellH, b.x * cellW, b.y * cellH);
        ctx.stroke();
        connected.add(best.j);
      }
    }

    for (const s of settlements) {
      ctx.fillStyle = '#c0392b';
      ctx.beginPath();
      ctx.arc(s.x * cellW, s.y * cellH, 5, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  generate();
  container.querySelector('#ow-regen').addEventListener('click', generate);
  wireMapExportSave(container, canvas, 'ow');
}
