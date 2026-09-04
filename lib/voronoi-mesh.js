// Hand-rolled Delaunay triangulation (Bowyer-Watson) + Voronoi cell
// derivation. Built in-house rather than vendoring d3-delaunay/Delaunator,
// to keep this project's zero-external-code convention -- a deliberate
// tradeoff (see the map-generator roadmap) whose real cost is numerical
// robustness. Three things pay for that cost here: jittered-grid (not
// uniform-random) point placement, which avoids the near-collinear/
// near-duplicate configurations that are the actual failure mode for a
// naive incircle predicate; an epsilon tolerance on every predicate instead
// of exact float comparison; and mirroring every real site across all four
// canvas edges before triangulating, so every real site ends up with a full
// triangle fan (a closed Voronoi cell) with no unbounded convex-hull edges
// to special-case. Ghost/mirror sites are discarded from the returned mesh.

const VORONOI_EPS = 1e-7;

// Grid-with-jitter point set, with a bounded rejection loop against
// near-duplicate placement (the other classic degenerate-input case for a
// hand-rolled triangulator). Iterated in row-major order, which becomes the
// mesh's canonical cell order -- every downstream consumer (biome/settlement
// passes) iterates `mesh.cells` in this same fixed order.
function jitterPoints(rng, width, height, count) {
  const cols = Math.max(1, Math.round(Math.sqrt((count * width) / height)));
  const rows = Math.max(1, Math.round(count / cols));
  const cellW = width / cols, cellH = height / rows;
  const minSep = Math.min(cellW, cellH) * 0.05;
  const points = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      let x, y, tries = 0;
      do {
        x = (c + 0.5 + (rng() - 0.5) * 0.7) * cellW;
        y = (r + 0.5 + (rng() - 0.5) * 0.7) * cellH;
        tries++;
      } while (tries < 5 && points.some((p) => Math.hypot(p.x - x, p.y - y) < minSep));
      points.push({ x, y });
    }
  }
  return points;
}

// Circumcircle center + squared radius for three points, or null when the
// three points are (epsilon-)collinear -- the caller skips such triangles
// entirely rather than trying to salvage a degenerate circumcircle.
function circumcircle(a, b, c) {
  const ax = a.x, ay = a.y, bx = b.x, by = b.y, cx = c.x, cy = c.y;
  const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
  if (Math.abs(d) < VORONOI_EPS) return null;
  const aSq = ax * ax + ay * ay, bSq = bx * bx + by * by, cSq = cx * cx + cy * cy;
  const ux = (aSq * (by - cy) + bSq * (cy - ay) + cSq * (ay - by)) / d;
  const uy = (aSq * (cx - bx) + bSq * (ax - cx) + cSq * (bx - ax)) / d;
  const r2 = (ux - ax) * (ux - ax) + (uy - ay) * (uy - ay);
  return { x: ux, y: uy, r2 };
}

function edgeKey(u, v) { return u < v ? u + '_' + v : v + '_' + u; }

// Incremental Bowyer-Watson: seed with one super-triangle enclosing every
// site, insert sites one at a time (find triangles whose circumcircle
// contains the new site, remove them, retriangulate the resulting cavity
// from its boundary edges), then drop every triangle still touching a
// super-triangle vertex. O(sites * triangles) -- fine for a map-generator's
// point counts, not meant to scale to survey-grade meshes.
function buildDelaunay(sites) {
  const n = sites.length;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of sites) {
    if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
  }
  const dmax = Math.max(maxX - minX, maxY - minY, 1) * 10;
  const midx = (minX + maxX) / 2, midy = (minY + maxY) / 2;
  const allPts = sites.concat([
    { x: midx - dmax, y: midy - dmax },
    { x: midx + dmax, y: midy - dmax },
    { x: midx, y: midy + dmax },
  ]);
  const superA = n, superB = n + 1, superC = n + 2;

  function makeTri(a, b, c) {
    return { a, b, c, cc: circumcircle(allPts[a], allPts[b], allPts[c]) };
  }

  let triangles = [makeTri(superA, superB, superC)];

  for (let pi = 0; pi < n; pi++) {
    const p = allPts[pi];
    const bad = [];
    for (const t of triangles) {
      if (t.cc) {
        const dx = p.x - t.cc.x, dy = p.y - t.cc.y;
        if (dx * dx + dy * dy < t.cc.r2 - VORONOI_EPS) bad.push(t);
      }
    }
    if (bad.length === 0) continue; // defensive: point exactly on an existing circumcircle boundary

    const edgeCount = new Map();
    const edgeList = [];
    for (const t of bad) {
      for (const [u, v] of [[t.a, t.b], [t.b, t.c], [t.c, t.a]]) {
        const k = edgeKey(u, v);
        const cnt = edgeCount.get(k) || 0;
        edgeCount.set(k, cnt + 1);
        if (cnt === 0) edgeList.push([u, v]);
      }
    }
    const boundary = edgeList.filter(([u, v]) => edgeCount.get(edgeKey(u, v)) === 1);

    const badSet = new Set(bad);
    triangles = triangles.filter((t) => !badSet.has(t));
    for (const [u, v] of boundary) triangles.push(makeTri(u, v, pi));
  }

  triangles = triangles.filter((t) => t.a < n && t.b < n && t.c < n);
  return { triangles, points: allPts };
}

// Sutherland-Hodgman clip of a convex polygon against an axis-aligned
// rectangle -- a safety net so a mesh is always fully bounded even if a
// mirrored site's cell were to (numerically) leak past the canvas edge.
function clipPolygonToRect(poly, minX, minY, maxX, maxY) {
  if (poly.length < 3) return poly;
  const stages = [
    { inside: (p) => p.x >= minX - VORONOI_EPS, cross: (p, q) => intersectVertical(p, q, minX) },
    { inside: (p) => p.x <= maxX + VORONOI_EPS, cross: (p, q) => intersectVertical(p, q, maxX) },
    { inside: (p) => p.y >= minY - VORONOI_EPS, cross: (p, q) => intersectHorizontal(p, q, minY) },
    { inside: (p) => p.y <= maxY + VORONOI_EPS, cross: (p, q) => intersectHorizontal(p, q, maxY) },
  ];
  let output = poly;
  for (const stage of stages) {
    const input = output;
    output = [];
    for (let i = 0; i < input.length; i++) {
      const curr = input[i];
      const prev = input[(i - 1 + input.length) % input.length];
      const currIn = stage.inside(curr), prevIn = stage.inside(prev);
      if (currIn) {
        if (!prevIn) output.push(stage.cross(prev, curr));
        output.push(curr);
      } else if (prevIn) {
        output.push(stage.cross(prev, curr));
      }
    }
    if (output.length === 0) break;
  }
  return output;
}
function intersectVertical(p, q, x) {
  const t = (x - p.x) / (q.x - p.x);
  return { x, y: p.y + t * (q.y - p.y) };
}
function intersectHorizontal(p, q, y) {
  const t = (y - p.y) / (q.y - p.y);
  return { x: p.x + t * (q.x - p.x), y };
}

function polygonArea(poly) {
  let area = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    area += a.x * b.y - b.x * a.y;
  }
  return Math.abs(area) / 2;
}

// Builds a bounded Voronoi mesh over [0,width] x [0,height]. `rng` should be
// a dedicated stream (callers offset the base seed, matching every other
// generative concern in these map generators) so mesh geometry never shares
// a sequence with height/moisture/texture/naming.
function buildVoronoiMesh(rng, width, height, cellCount) {
  const realPoints = jitterPoints(rng, width, height, Math.max(4, cellCount));
  const n = realPoints.length;

  const ghosts = [];
  for (const p of realPoints) {
    ghosts.push({ x: -p.x, y: p.y });
    ghosts.push({ x: 2 * width - p.x, y: p.y });
    ghosts.push({ x: p.x, y: -p.y });
    ghosts.push({ x: p.x, y: 2 * height - p.y });
  }
  const allSites = realPoints.concat(ghosts);

  const { triangles, points } = buildDelaunay(allSites);

  const incident = new Map();
  const neighborSets = new Map();
  function addIncident(idx, t) {
    if (!incident.has(idx)) incident.set(idx, []);
    incident.get(idx).push(t);
  }
  function addEdge(u, v) {
    if (!neighborSets.has(u)) neighborSets.set(u, new Set());
    if (!neighborSets.has(v)) neighborSets.set(v, new Set());
    neighborSets.get(u).add(v);
    neighborSets.get(v).add(u);
  }
  for (const t of triangles) {
    addIncident(t.a, t); addIncident(t.b, t); addIncident(t.c, t);
    addEdge(t.a, t.b); addEdge(t.b, t.c); addEdge(t.c, t.a);
  }

  const cells = [];
  for (let i = 0; i < n; i++) {
    const site = points[i];
    const tris = incident.get(i) || [];
    const ccs = tris.map((t) => t.cc).filter(Boolean);
    ccs.sort((a, b) => Math.atan2(a.y - site.y, a.x - site.x) - Math.atan2(b.y - site.y, b.x - site.x));

    const poly = [];
    for (const pt of ccs) {
      const last = poly[poly.length - 1];
      if (!last || Math.hypot(last.x - pt.x, last.y - pt.y) > VORONOI_EPS) poly.push({ x: pt.x, y: pt.y });
    }
    if (poly.length > 1) {
      const first = poly[0], last = poly[poly.length - 1];
      if (Math.hypot(first.x - last.x, first.y - last.y) < VORONOI_EPS) poly.pop();
    }

    let clipped = poly.length >= 3 ? clipPolygonToRect(poly, 0, 0, width, height) : poly;
    // Defensive fallback: a genuinely degenerate cell (should not happen for
    // an interior site once ghost mirroring closes its triangle fan, but
    // this is exactly the seed-dependent failure mode hand-rolling accepts
    // the risk of) still renders as a small square instead of vanishing or
    // crashing the draw loop.
    if (clipped.length < 3) {
      const half = Math.min(width, height) * 0.004;
      clipped = [
        { x: site.x - half, y: site.y - half }, { x: site.x + half, y: site.y - half },
        { x: site.x + half, y: site.y + half }, { x: site.x - half, y: site.y + half },
      ];
    }

    const neighbors = Array.from(neighborSets.get(i) || []).filter((idx) => idx < n);
    cells.push({ x: site.x, y: site.y, polygon: clipped, neighbors, index: i });
  }

  return { cells, width, height };
}
