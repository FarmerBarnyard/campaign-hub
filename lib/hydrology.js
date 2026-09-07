// River routing over a Voronoi mesh's cell-adjacency graph. Each land cell
// drains to its single lowest neighbor (steepest descent); flow accumulates
// in one pass over cells sorted highest-to-lowest, so every upstream
// contributor has already been folded in by the time a cell hands its flow
// onward. O(n log n) for the sort, O(n) for the pass -- no iterative
// simulation, and purely a deterministic function of the height field
// already generated for the seed, so it needs no rng of its own.
//
// Local minima above sea level (a cell with no lower neighbor) terminate as
// a small lake marker rather than a full priority-flood depression fill --
// a materially more complex technique the roadmap explicitly defers.
function computeHydrology(cells, heights, seaLevel) {
  const n = cells.length;
  const downhill = new Int32Array(n).fill(-1);
  const flow = new Float64Array(n);
  const isLake = new Uint8Array(n);

  const order = [];
  for (let i = 0; i < n; i++) if (heights[i] >= seaLevel) order.push(i);
  order.sort((a, b) => heights[b] - heights[a]);

  for (const i of order) {
    flow[i] += 1;
    // Steepest descent by SLOPE (height drop / distance), not raw height --
    // on a Voronoi mesh every neighbor sits at roughly the same distance, so
    // comparing raw height was an acceptable shortcut, but an 8-connected
    // grid's diagonal neighbors are sqrt(2) farther than its cardinal ones.
    // Comparing raw height there systematically favors a diagonal neighbor
    // even when a cardinal one has a shallower true slope, which reads as
    // rivers preferring diagonal jogs for no physical reason.
    let lowest = -1, bestSlope = 0;
    for (const nb of cells[i].neighbors) {
      const drop = heights[i] - heights[nb];
      if (drop <= 0) continue;
      const dist = Math.hypot(cells[i].x - cells[nb].x, cells[i].y - cells[nb].y);
      const slope = drop / dist;
      if (slope > bestSlope) { bestSlope = slope; lowest = nb; }
    }
    downhill[i] = lowest;
    if (lowest === -1) {
      isLake[i] = 1;
    } else if (heights[lowest] >= seaLevel) {
      // Only land-to-land hops carry flow onward; a hop into the sea is the
      // river reaching the coast, which the segment extraction below still
      // draws (the last leg into an ocean cell), it just doesn't accumulate
      // past that point.
      flow[lowest] += flow[i];
    }
  }

  return { downhill, flow, isLake };
}

// `isLake` from computeHydrology is a per-cell flag only -- it can't tell
// two separate lakes apart, which the Scrying Pool wild-zone feature needs
// (decorate the SINGLE LARGEST lake, not every lake equally). Flood-fills
// connected isLake cells via the same mesh adjacency graph computeHydrology
// itself already walks, purely a function of already-cached data like
// riverFlowThreshold above -- no rng needed.
function labelLakes(cells, isLake) {
  const n = cells.length;
  const lakeIdOf = new Int32Array(n).fill(-1);
  const sizes = [];
  for (let i = 0; i < n; i++) {
    if (!isLake[i] || lakeIdOf[i] !== -1) continue;
    const id = sizes.length;
    let size = 0;
    const stack = [i];
    lakeIdOf[i] = id;
    while (stack.length) {
      const cur = stack.pop();
      size++;
      for (const nb of cells[cur].neighbors) {
        if (isLake[nb] && lakeIdOf[nb] === -1) { lakeIdOf[nb] = id; stack.push(nb); }
      }
    }
    sizes.push(size);
  }
  let largestId = -1, largestSize = 0;
  sizes.forEach((s, id) => { if (s > largestSize) { largestSize = s; largestId = id; } });
  return { lakeIdOf, sizes, largestId };
}

// A river-worthy flow threshold that scales with how many land cells exist,
// rather than a fixed constant -- so the river count stays visually sane
// whether the mesh has 50 cells or 1000. Picks the flow value at the top
// `topFraction` of land cells by flow, floored at `minFlow` so isolated
// single-cell trickles (flow === 1, no upstream contributor) never qualify.
function riverFlowThreshold(flow, landCellIndices, topFraction, minFlow) {
  if (landCellIndices.length === 0) return Infinity;
  const sorted = landCellIndices.map((i) => flow[i]).sort((a, b) => b - a);
  const cut = Math.max(0, Math.min(sorted.length - 1, Math.floor(sorted.length * topFraction)));
  return Math.max(minFlow, sorted[cut]);
}
