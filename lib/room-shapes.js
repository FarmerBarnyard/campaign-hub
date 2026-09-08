// Room/corridor carving primitives for grid-based structured-site maps.
// Extracted verbatim from views/map-dungeon.js (the BSP dungeon generator,
// which still owns the actual room-placement/BSP-split logic and remains
// the primary caller) so views/map-landmark.js's smaller site-layout
// generator can reuse the exact same, already-tested carving math instead
// of a second copy that could drift. Every function here already took its
// grid/coords as plain arguments rather than closing over generator state,
// so this is a pure relocation -- no behavior change, no call-site changes
// in map-dungeon.js beyond carveCorridor (see below).

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

// Promoted from a views/map-dungeon.js-local closure (which captured `grid`
// from its enclosing generate()) to a plain function -- it never touched
// anything else from that closure, so this is a mechanical parameterization,
// not a behavior change. An L-shaped orthogonal walk: step x from a.cx to
// b.cx, then y from a.cy to b.cy, converting any rock(0) cell it crosses to
// corridor(2). Never overwrites an existing room(1) cell, which is what
// keeps rooms and corridors mutually exclusive by construction everywhere
// else in this file relies on that.
function carveCorridor(grid, a, b) {
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
