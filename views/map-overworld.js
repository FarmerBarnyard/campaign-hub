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
      if (r > 0.55) return;
      const size = Math.min(cw, ch) * 0.32;
      ctx.fillStyle = ink;
      ctx.globalAlpha = 0.55;
      ctx.beginPath();
      ctx.moveTo(cx, cy - size);
      ctx.lineTo(cx - size * 0.7, cy + size * 0.5);
      ctx.lineTo(cx + size * 0.7, cy + size * 0.5);
      ctx.closePath();
      ctx.fill();
      ctx.fillRect(cx - size * 0.08, cy + size * 0.4, size * 0.16, size * 0.35);
      ctx.globalAlpha = 1;
      break;
    }
    case 'mountains': {
      if (r > 0.75) return;
      const w = cw * 0.85, h = ch * 0.7;
      ctx.fillStyle = ink;
      ctx.globalAlpha = 0.5;
      ctx.beginPath();
      ctx.moveTo(cx, cy - h / 2);
      ctx.lineTo(cx - w / 2, cy + h / 2);
      ctx.lineTo(cx + w / 2, cy + h / 2);
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = 0.85;
      ctx.beginPath();
      ctx.moveTo(cx, cy - h / 2);
      ctx.lineTo(cx - w * 0.12, cy - h * 0.05);
      ctx.lineTo(cx + w * 0.08, cy - h * 0.05);
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = 1;
      break;
    }
    case 'hills': {
      if (r > 0.4) return;
      ctx.strokeStyle = ink;
      ctx.globalAlpha = 0.45;
      ctx.lineWidth = Math.max(1, ch * 0.06);
      ctx.beginPath();
      ctx.arc(cx, cy + ch * 0.3, cw * 0.4, Math.PI, 0);
      ctx.stroke();
      ctx.globalAlpha = 1;
      break;
    }
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

// Overworld/region map: value-noise heightmap (fbm), biome bands, settlements
// placed by scoring settleable cells with a min-distance filter, roads via a
// nearest-neighbor MST approximation. Settlement tiers and biome texture are
// purely cosmetic passes over that same data -- neither perturbs the
// underlying generation, so a given seed still reproduces the same land
// shape/settlement positions across themes and re-generates.
function renderOverworldMap(container) {
  container.innerHTML = `
    <h2>Overworld map generator</h2>
    <div class="map-layout">
      <div class="map-controls">
        <label>Seed <input id="ow-seed" type="number" value="${Math.floor(Math.random() * 1e6)}"></label>
        <label>Theme <select id="ow-theme"></select></label>
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
  populateThemeSelect(container.querySelector('#ow-theme'));

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
    const theme = MAP_THEMES[container.querySelector('#ow-theme').value] || MAP_THEMES[MAP_THEME_DEFAULT];
    const palette = theme.overworld;

    const rng = mulberry32(seed);
    const height = fbm(rng, gw, gh, octaves);
    const moisture = fbm(mulberry32(seed + 99991), gw, gh, Math.max(1, octaves - 1));
    // Dedicated rngs for the two cosmetic-only passes (biome texture,
    // settlement names) -- kept separate from `rng` above so switching
    // themes or regenerating never perturbs terrain/settlement placement,
    // and separate from each other so texture density doesn't shift names.
    const textureRng = mulberry32(seed + 55555);
    const nameRng = mulberry32(seed + 33333);

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
        ctx.fillStyle = palette.biomes[b];
        ctx.fillRect(x * cellW, y * cellH, cellW + 1, cellH + 1);
        paintBiomeTexture(ctx, b, x * cellW + cellW / 2, y * cellH + cellH / 2, cellW, cellH, textureRng, palette.ink);
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

    // Rank by score to assign settlement tiers -- the greedy min-distance
    // selection above already tends to add settlements in roughly
    // descending score order, but re-sort explicitly rather than relying
    // on that as a guarantee. Tiers are cosmetic (marker size, label
    // weight, name-suffix flavor) and never feed back into placement.
    const byScore = settlements.slice().sort((a, b) => b.score - a.score);
    const cityCount = Math.max(1, Math.round(byScore.length * 0.15));
    const townCount = Math.max(0, Math.round(byScore.length * 0.35));
    byScore.forEach((s, i) => {
      s.tier = i < cityCount ? 'city' : i < cityCount + townCount ? 'town' : 'village';
      s.name = generateSettlementName(nameRng, s.tier);
    });

    ctx.strokeStyle = palette.road;
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

    const TIER_RADIUS = { village: 3.5, town: 5.5, city: 8 };
    const TIER_FONT = { village: '10px sans-serif', town: 'bold 11px sans-serif', city: 'bold 13px sans-serif' };
    for (const s of settlements) {
      const px = s.x * cellW, py = s.y * cellH;
      const r = TIER_RADIUS[s.tier];
      ctx.fillStyle = palette.settlement[s.tier];
      ctx.beginPath();
      ctx.arc(px, py, r, 0, Math.PI * 2);
      ctx.fill();
      if (s.tier === 'city') {
        ctx.strokeStyle = palette.settlement[s.tier];
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(px, py, r + 3, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.font = TIER_FONT[s.tier];
      ctx.fillStyle = palette.label;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText(s.name, px, py + r + 3);
    }
  }

  generate();
  container.querySelector('#ow-regen').addEventListener('click', generate);
  container.querySelector('#ow-theme').addEventListener('change', generate);
  wireMapExportSave(container, canvas, 'ow');
}
