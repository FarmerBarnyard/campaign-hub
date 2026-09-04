// Settlement/town-scale map: drilled into from a settlement marker on the
// overworld map (map-overworld.js). Reuses lib/voronoi-mesh.js at
// building-plot density instead of terrain-cell density -- same mesh code,
// different scale of what a "cell" represents.
//
// The town's own seed is *derived* from (overworldSeed, settlementIndex)
// rather than entered by hand, so there is nothing here for the user to
// desync: regenerating the same overworld seed and clicking the same
// settlement always reproduces the identical town. Deliberately no
// "Regenerate" control -- reseeding the layout independently of the
// overworld settlement it belongs to would break that guarantee.
function deriveSettlementSeed(overworldSeed, idx) {
  const mixSeed = (overworldSeed ^ Math.imul(idx + 1, 0x9e3779b1)) >>> 0;
  const mixRng = mulberry32(mixSeed);
  return Math.floor(mixRng() * 0xffffffff) >>> 0;
}

// Tier drives scale and density, matching the tier already assigned on the
// overworld map: village = small and sparse with no wall; town = denser
// with a wall and a couple of gates; city = densest, walled, more gates.
const SETTLEMENT_TIER_CONFIG = {
  village: { cellCount: 55, radius: 160, spokes: 4, rings: 1, wall: false, gates: 0 },
  town: { cellCount: 120, radius: 230, spokes: 6, rings: 2, wall: true, gates: 2 },
  city: { cellCount: 210, radius: 300, spokes: 8, rings: 3, wall: true, gates: 3 },
};

function renderSettlementMap(container, params) {
  const overworldSeed = parseInt(params.get('seed'), 10) || 1;
  const idx = parseInt(params.get('idx'), 10) || 0;
  const name = params.get('name') || 'Unnamed settlement';
  const tierKey = SETTLEMENT_TIER_CONFIG[params.get('tier')] ? params.get('tier') : 'village';
  const config = SETTLEMENT_TIER_CONFIG[tierKey];
  const seed = deriveSettlementSeed(overworldSeed, idx);

  container.innerHTML = `
    <h2 id="st-heading"></h2>
    <p><a href="#/map/overworld">&larr; Back to overworld map</a></p>
    <div class="map-layout">
      <div class="map-controls">
        <label>Theme <select id="st-theme"></select></label>
        <p class="status-text">Derived from overworld seed ${overworldSeed}, settlement #${idx + 1} -- this layout is fixed to that settlement and can't be reseeded independently.</p>
        <hr>
        <button id="st-export">Export PNG</button>
        <label>Save as <input id="st-filename" placeholder="filename.png" autocomplete="off"></label>
        <label>Campaign <select id="st-campaign"></select></label>
        <button id="st-save">Save to campaign</button>
        <p id="st-status" class="status-text"></p>
      </div>
      <canvas id="st-canvas" width="700" height="700"></canvas>
    </div>
  `;
  container.querySelector('#st-heading').textContent = `${name} (${tierKey})`;

  populateCampaignSelect(container.querySelector('#st-campaign'));
  populateThemeSelect(container.querySelector('#st-theme'));

  const canvas = container.querySelector('#st-canvas');
  // `let`, not `const` -- wireMapExportSave's high-res export temporarily
  // points this at an offscreen context so generate() redraws there instead
  // of the on-screen canvas, then restores it.
  let ctx = canvas.getContext('2d');

  function generate() {
    const theme = MAP_THEMES[container.querySelector('#st-theme').value] || MAP_THEMES[MAP_THEME_DEFAULT];
    const palette = theme.settlement;

    // Dedicated rng streams, same isolation convention as the overworld/
    // dungeon generators: mesh geometry, wall-gate placement, and building
    // footprint variety must never perturb each other or the town layout
    // itself when a theme switch redraws the same seed.
    const meshRng = mulberry32(seed + 77777);
    const wallRng = mulberry32(seed + 991);
    const buildingRng = mulberry32(seed + 55555);

    const cx = canvas.width / 2, cy = canvas.height / 2;
    const R = config.radius;
    const streetWidth = Math.max(10, R * 0.045);
    const plazaR = R * 0.08;

    const spokeAngles = [];
    for (let i = 0; i < config.spokes; i++) spokeAngles.push((i / config.spokes) * Math.PI * 2);
    const ringRadii = [];
    for (let i = 1; i <= config.rings; i++) ringRadii.push(R * (i / (config.rings + 1)));

    function distToSpokes(x, y) {
      const dx = x - cx, dy = y - cy;
      const dist = Math.hypot(dx, dy);
      if (dist < 1) return 0;
      const angle = Math.atan2(dy, dx);
      let best = Infinity;
      for (const spokeAngle of spokeAngles) {
        let diff = Math.abs(angle - spokeAngle) % (Math.PI * 2);
        if (diff > Math.PI) diff = Math.PI * 2 - diff;
        best = Math.min(best, dist * Math.sin(diff));
      }
      return Math.abs(best);
    }
    function distToRings(x, y) {
      const dist = Math.hypot(x - cx, y - cy);
      let best = Infinity;
      for (const ringR of ringRadii) best = Math.min(best, Math.abs(dist - ringR));
      return best;
    }

    const mesh = buildVoronoiMesh(meshRng, canvas.width, canvas.height, config.cellCount);

    ctx.fillStyle = palette.ground;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Street network: spokes radiating from the plaza plus concentric
    // rings, drawn directly as strokes rather than derived from Voronoi
    // edges -- simpler to get right for a v1, per the roadmap's own note
    // that a proper Voronoi-edge street layout is a later refinement.
    ctx.strokeStyle = palette.street;
    ctx.lineWidth = streetWidth;
    ctx.lineCap = 'round';
    for (const angle of spokeAngles) {
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(angle) * plazaR, cy + Math.sin(angle) * plazaR);
      ctx.lineTo(cx + Math.cos(angle) * R, cy + Math.sin(angle) * R);
      ctx.stroke();
    }
    for (const ringR of ringRadii) {
      ctx.beginPath();
      ctx.arc(cx, cy, ringR, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Buildings: every mesh cell inside the settlement bound that isn't the
    // plaza or a street gets a footprint, shrunk toward its own centroid so
    // a visible gap separates neighboring buildings.
    ctx.fillStyle = palette.building;
    for (const cell of mesh.cells) {
      const dist = Math.hypot(cell.x - cx, cell.y - cy);
      if (dist > R || dist < plazaR) continue;
      if (distToSpokes(cell.x, cell.y) < streetWidth / 2) continue;
      if (distToRings(cell.x, cell.y) < streetWidth / 2) continue;
      const poly = cell.polygon;
      if (poly.length < 3) continue;
      const shrink = 0.7 + buildingRng() * 0.14;
      ctx.beginPath();
      for (let i = 0; i < poly.length; i++) {
        const p = poly[i];
        const sx = cell.x + (p.x - cell.x) * shrink;
        const sy = cell.y + (p.y - cell.y) * shrink;
        if (i === 0) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy);
      }
      ctx.closePath();
      ctx.fill();
    }

    ctx.fillStyle = palette.plaza;
    ctx.beginPath();
    ctx.arc(cx, cy, plazaR, 0, Math.PI * 2);
    ctx.fill();

    if (config.wall) {
      const wallR = R * 1.05;
      const gateHalfWidth = 0.1;
      const gateAngles = [];
      for (let i = 0; i < config.gates; i++) {
        gateAngles.push((i / config.gates) * Math.PI * 2 + (wallRng() - 0.5) * 0.5);
      }
      function nearGate(angle) {
        return gateAngles.some((g) => {
          let diff = Math.abs(angle - g) % (Math.PI * 2);
          if (diff > Math.PI) diff = Math.PI * 2 - diff;
          return diff < gateHalfWidth;
        });
      }
      ctx.strokeStyle = palette.wall;
      ctx.lineWidth = Math.max(3, R * 0.022);
      ctx.lineCap = 'butt';
      const segments = 160;
      let penDown = false;
      ctx.beginPath();
      for (let i = 0; i <= segments; i++) {
        const angle = (i / segments) * Math.PI * 2;
        const x = cx + Math.cos(angle) * wallR, y = cy + Math.sin(angle) * wallR;
        if (nearGate(angle)) { penDown = false; continue; }
        if (!penDown) { ctx.moveTo(x, y); penDown = true; } else ctx.lineTo(x, y);
      }
      ctx.stroke();
      // Short perpendicular tick at each gate opening, matching the
      // dungeon generator's door-tick convention.
      ctx.lineWidth = Math.max(2, R * 0.016);
      for (const g of gateAngles) {
        const gx = cx + Math.cos(g) * wallR, gy = cy + Math.sin(g) * wallR;
        const perp = g + Math.PI / 2;
        const half = streetWidth * 0.6;
        ctx.beginPath();
        ctx.moveTo(gx - Math.cos(perp) * half, gy - Math.sin(perp) * half);
        ctx.lineTo(gx + Math.cos(perp) * half, gy + Math.sin(perp) * half);
        ctx.stroke();
      }
    }
  }

  generate();
  container.querySelector('#st-theme').addEventListener('change', generate);
  wireMapExportSave(container, canvas, 'st', (offCtx) => {
    const prevCtx = ctx;
    ctx = offCtx;
    generate();
    ctx = prevCtx;
  });
}
