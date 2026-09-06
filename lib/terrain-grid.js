// Regular-grid terrain generation replacing the Voronoi mesh for the
// overworld generator specifically (lib/voronoi-mesh.js's actual Delaunay/
// Voronoi code is untouched -- views/map-settlement.js still uses it for an
// unrelated generator). A grid cell exposes the exact same
// `{x, y, index, neighbors}` shape a Voronoi cell did, which is why
// hydrology, naming regions, settlement scoring, and road routing all port
// onto this with no interface changes -- verified by reading every one of
// them before writing this file: none of them touch polygon geometry, only
// generic adjacency + plain coordinates. No `.polygon` field -- rendering
// shifts from per-cell polygon fill to per-region contour fill (see
// extractGridContours below), so individual cells no longer need one.

// 8-connected (Moore) adjacency -- 4-connected would force rivers and roads
// to bend only in 90-degree steps, which reads worse than the "cellular"
// look this whole rewrite exists to fix.
function buildTerrainGrid(rng, width, height, targetCellCount) {
  const cols = Math.max(2, Math.round(Math.sqrt((targetCellCount * width) / height)));
  const rows = Math.max(2, Math.round(targetCellCount / cols));
  const cellW = width / cols, cellH = height / rows;
  const cells = new Array(cols * rows);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const index = r * cols + c;
      const neighbors = [];
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (dr === 0 && dc === 0) continue;
          const nr = r + dr, nc = c + dc;
          if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
          neighbors.push(nr * cols + nc);
        }
      }
      cells[index] = { x: (c + 0.5) * cellW, y: (r + 0.5) * cellH, index, neighbors };
    }
  }
  return { cells, width, height, cols, rows, cellW, cellH };
}

// Bilinear height lookup at a fractional (col, row) position -- shared by
// erosion (droplet position is continuous) and anything else that needs an
// off-grid-point sample. Clamps to the grid edge rather than wrapping or
// throwing, since erosion deliberately stops a droplet that walks off-grid
// but still needs one last valid sample to compute its final deposit.
function bilinearHeight(heights, cols, rows, fx, fy) {
  const x0 = Math.max(0, Math.min(cols - 1, Math.floor(fx)));
  const y0 = Math.max(0, Math.min(rows - 1, Math.floor(fy)));
  const x1 = Math.min(cols - 1, x0 + 1);
  const y1 = Math.min(rows - 1, y0 + 1);
  const sx = fx - x0, sy = fy - y0;
  const h00 = heights[y0 * cols + x0], h10 = heights[y0 * cols + x1];
  const h01 = heights[y1 * cols + x0], h11 = heights[y1 * cols + x1];
  const top = h00 + (h10 - h00) * sx;
  const bot = h01 + (h11 - h01) * sx;
  return top + (bot - top) * sy;
}

function bilinearGradient(heights, cols, rows, fx, fy) {
  const eps = 0.5;
  const hL = bilinearHeight(heights, cols, rows, fx - eps, fy);
  const hR = bilinearHeight(heights, cols, rows, fx + eps, fy);
  const hU = bilinearHeight(heights, cols, rows, fx, fy - eps);
  const hD = bilinearHeight(heights, cols, rows, fx, fy + eps);
  return { gx: (hR - hL) / (2 * eps), gy: (hD - hU) / (2 * eps) };
}

// Standard droplet-based hydraulic erosion (the well-documented Lague/Beyer
// technique -- publicly established, verified here by testing the actual
// output, not by checking a reference image the way the WotC art style
// needed). Each droplet follows the downhill gradient with inertia, erodes
// or deposits sediment each step based on capacity vs. carried load, and
// deposits/erodes via bilinear weighting across the 4 nearest cells to
// avoid single-cell spikes. Mutates `heights` in place. No per-step
// allocation in the inner loop -- droplet state is a handful of local
// numbers, not an object -- since the cost estimate for this technique
// (droplets x lifetime, tens of millions of ops) is only comfortably
// sub-second if the inner loop isn't allocating.
function applyHydraulicErosion(heights, cols, rows, rng, params) {
  const p = Object.assign({
    dropletCount: Math.round((cols * rows) * 1.5),
    maxLifetime: 30,
    inertia: 0.05,
    sedimentCapacityFactor: 4,
    minSlope: 0.01,
    depositSpeed: 0.3,
    erodeSpeed: 0.3,
    evaporateSpeed: 0.01,
    gravity: 4,
    erosionRadius: 2,
  }, params || {});

  for (let d = 0; d < p.dropletCount; d++) {
    let posX = rng() * (cols - 1);
    let posY = rng() * (rows - 1);
    let dirX = 0, dirY = 0;
    let speed = 1, water = 1, sediment = 0;

    for (let step = 0; step < p.maxLifetime; step++) {
      const nodeX = Math.floor(posX), nodeY = Math.floor(posY);
      const { gx, gy } = bilinearGradient(heights, cols, rows, posX, posY);
      dirX = dirX * p.inertia - gx * (1 - p.inertia);
      dirY = dirY * p.inertia - gy * (1 - p.inertia);
      const len = Math.max(1e-8, Math.hypot(dirX, dirY));
      dirX /= len; dirY /= len;

      const newX = posX + dirX, newY = posY + dirY;
      if (newX < 0 || newX >= cols - 1 || newY < 0 || newY >= rows - 1) break;

      const oldHeight = bilinearHeight(heights, cols, rows, posX, posY);
      const newHeight = bilinearHeight(heights, cols, rows, newX, newY);
      const deltaHeight = newHeight - oldHeight;

      const capacity = Math.max(-deltaHeight, p.minSlope) * speed * water * p.sedimentCapacityFactor;

      if (sediment > capacity || deltaHeight > 0) {
        const deposit = deltaHeight > 0
          ? Math.min(deltaHeight, sediment)
          : (sediment - capacity) * p.depositSpeed;
        sediment -= deposit;
        depositAt(heights, cols, rows, posX, posY, deposit);
      } else {
        const erode = Math.min((capacity - sediment) * p.erodeSpeed, -deltaHeight);
        erodeAt(heights, cols, rows, posX, posY, erode, p.erosionRadius);
        sediment += erode;
      }

      speed = Math.sqrt(Math.max(0, speed * speed + deltaHeight * -p.gravity));
      water *= (1 - p.evaporateSpeed);
      posX = newX; posY = newY;
      if (water < 0.01) break;
    }
  }
}

// Bilinear-weighted deposit across the 4 cells surrounding a fractional
// position -- depositing onto a single rounded-to-nearest cell would leave
// visible single-cell spikes/pits instead of a smooth erosion trail.
function depositAt(heights, cols, rows, fx, fy, amount) {
  const x0 = Math.max(0, Math.min(cols - 1, Math.floor(fx)));
  const y0 = Math.max(0, Math.min(rows - 1, Math.floor(fy)));
  const x1 = Math.min(cols - 1, x0 + 1);
  const y1 = Math.min(rows - 1, y0 + 1);
  const sx = fx - x0, sy = fy - y0;
  heights[y0 * cols + x0] += amount * (1 - sx) * (1 - sy);
  heights[y0 * cols + x1] += amount * sx * (1 - sy);
  heights[y1 * cols + x0] += amount * (1 - sx) * sy;
  heights[y1 * cols + x1] += amount * sx * sy;
}

function erodeAt(heights, cols, rows, fx, fy, amount, radius) {
  const cx = Math.round(fx), cy = Math.round(fy);
  const weights = [];
  let totalWeight = 0;
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const x = cx + dx, y = cy + dy;
      if (x < 0 || x >= cols || y < 0 || y >= rows) continue;
      const dist = Math.hypot(dx, dy);
      if (dist > radius) continue;
      const w = Math.max(0, radius - dist);
      weights.push({ i: y * cols + x, w });
      totalWeight += w;
    }
  }
  if (totalWeight <= 0) return;
  for (const { i, w } of weights) {
    heights[i] -= amount * (w / totalWeight);
  }
}

// Thermal erosion: wherever a cell's slope to a neighbor exceeds a talus
// angle, slide a fraction of the height difference downhill. A few cheap
// iterations smooth hydraulic erosion's sharper artifacts into natural
// scree slopes -- no rng, purely deterministic geometry over the height
// field.
function applyThermalErosion(heights, cols, rows, iterations, talusAngle, fraction) {
  talusAngle = talusAngle == null ? 0.02 : talusAngle;
  fraction = fraction == null ? 0.5 : fraction;
  const next = new Float64Array(heights.length);
  for (let iter = 0; iter < iterations; iter++) {
    next.set(heights);
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const i = y * cols + x;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            const nx = x + dx, ny = y + dy;
            if (nx < 0 || nx >= cols || ny < 0 || ny >= rows) continue;
            const j = ny * cols + nx;
            const dist = Math.hypot(dx, dy);
            const drop = heights[i] - heights[j];
            const slope = drop / dist;
            if (slope > talusAngle) {
              const move = (drop - talusAngle * dist) * fraction * 0.125;
              next[i] -= move;
              next[j] += move;
            }
          }
        }
      }
    }
    heights.set(next);
  }
}

// Naive pit-filling: raise each land-side local minimum to match its lowest
// neighbor. A full priority-flood depression-fill is a materially larger
// technique this project doesn't attempt -- this is the deliberately
// bounded mitigation for erosion producing many more small pits than the
// old coarse Voronoi height field ever had, so rivers don't fragment into a
// field of tiny dead-end lakes. Single pass, not iterative -- sufficient
// for single/few-cell noise pits, which is what erosion actually produces;
// a real multi-cell basin stays a real lake, which is correct.
function fillPits(heights, cols, rows, seaLevel) {
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const i = y * cols + x;
      if (heights[i] < seaLevel) continue;
      let lowestNeighbor = Infinity;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || nx >= cols || ny < 0 || ny >= rows) continue;
          lowestNeighbor = Math.min(lowestNeighbor, heights[ny * cols + nx]);
        }
      }
      if (lowestNeighbor > heights[i]) heights[i] = lowestNeighbor;
    }
  }
}

// Marching squares: extracts smooth contour segments where `valueAt(i)`
// crosses `threshold`, walking every 2x2 block of grid cells. Interpolates
// each edge crossing using the actual scalar values (not just the cell-
// center midpoint), so the contour lands at the true threshold crossing --
// this is what makes the result read as organic rather than blocky, the
// entire point of this rewrite. Returns raw `[[p1,p2], ...]` segments in
// CANVAS pixel coordinates, meant to be fed into the existing, unchanged
// global `chainSegments()` (lib/voronoi-mesh.js) for threading into ordered
// polylines -- paintWatercolorWash/chaikinSmooth/stroke code downstream
// need zero changes, they just receive smoother input than Voronoi-edge
// walking ever produced.
//
// Two correctness details handled explicitly rather than left to be
// discovered later: saddle-point ambiguity (the classic case 5/10 of the
// 16-case table) is resolved via the standard asymptotic decider -- compare
// the average of the four corner values against the threshold to pick the
// correct diagonal connection, since guessing wrong silently produces wrong
// topology (a peninsula spuriously split in two, a strait spuriously sealed
// shut) rather than a crash. Divide-by-zero on equal/near-equal adjacent
// corner values (a flat eroded terrace, or island-mode falloff zeroing
// height identically at the map edge) falls back to the edge midpoint.
function extractGridContours(cols, rows, cellW, cellH, valueAt, threshold) {
  const EPS = 1e-9;
  const segments = [];

  function edgePoint(ax, ay, bx, by, va, vb) {
    let t;
    if (Math.abs(vb - va) < EPS) {
      t = 0.5;
    } else {
      t = (threshold - va) / (vb - va);
      t = Math.max(0, Math.min(1, t));
    }
    return { x: ax + (bx - ax) * t, y: ay + (by - ay) * t };
  }

  for (let y = 0; y < rows - 1; y++) {
    for (let x = 0; x < cols - 1; x++) {
      const iTL = y * cols + x, iTR = y * cols + (x + 1);
      const iBL = (y + 1) * cols + x, iBR = (y + 1) * cols + (x + 1);
      const vTL = valueAt(iTL), vTR = valueAt(iTR), vBL = valueAt(iBL), vBR = valueAt(iBR);

      const cTL = vTL >= threshold, cTR = vTR >= threshold, cBL = vBL >= threshold, cBR = vBR >= threshold;
      const caseIndex = (cTL ? 8 : 0) | (cTR ? 4 : 0) | (cBR ? 2 : 0) | (cBL ? 1 : 0);
      if (caseIndex === 0 || caseIndex === 15) continue;

      const px = x * cellW, py = y * cellH;
      const top = () => edgePoint(px, py, px + cellW, py, vTL, vTR);
      const right = () => edgePoint(px + cellW, py, px + cellW, py + cellH, vTR, vBR);
      const bottom = () => edgePoint(px, py + cellH, px + cellW, py + cellH, vBL, vBR);
      const left = () => edgePoint(px, py, px, py + cellH, vTL, vBL);

      switch (caseIndex) {
        case 1: segments.push([left(), bottom()]); break;
        case 2: segments.push([bottom(), right()]); break;
        case 3: segments.push([left(), right()]); break;
        case 4: segments.push([top(), right()]); break;
        case 5: {
          // Saddle: average-of-four-corners decider picks which pair of
          // diagonal segments is topologically correct.
          const avg = (vTL + vTR + vBL + vBR) / 4;
          if (avg >= threshold) {
            segments.push([left(), top()]);
            segments.push([bottom(), right()]);
          } else {
            segments.push([left(), bottom()]);
            segments.push([top(), right()]);
          }
          break;
        }
        case 6: segments.push([top(), bottom()]); break;
        case 7: segments.push([left(), top()]); break;
        case 8: segments.push([left(), top()]); break;
        case 9: segments.push([top(), bottom()]); break;
        case 10: {
          const avg = (vTL + vTR + vBL + vBR) / 4;
          if (avg >= threshold) {
            segments.push([left(), bottom()]);
            segments.push([top(), right()]);
          } else {
            segments.push([left(), top()]);
            segments.push([bottom(), right()]);
          }
          break;
        }
        case 11: segments.push([top(), right()]); break;
        case 12: segments.push([left(), right()]); break;
        case 13: segments.push([bottom(), right()]); break;
        case 14: segments.push([left(), bottom()]); break;
      }
    }
  }
  return segments;
}
