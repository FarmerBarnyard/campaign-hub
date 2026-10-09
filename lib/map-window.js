// A window onto the overworld: "zoom into this rectangle of the map".
//
// The overworld is a pure function of a handful of numbers (lib/overworld-world.js), so a zoomed-in
// map does not need the terrain, rivers or biomes passed to it -- it rebuilds the same world from
// those numbers and READS the chosen rectangle out of it. The address of a window is therefore the
// world's settings plus three numbers for the rectangle:
//
//   seed=938479&oc=40000&oo=4&oi=1&orv=1&os=6&sea=0.42&ofb=0&orb=0&owz=1&osc=s&wx=0.125&wy=0.25&ww=0.25
//
//   seed, oc, oo, oi, orv, os, sea   the overworld's seed, cells, octaves, island, rivers, settlements, sea level
//   ofb, orb                         its Vegetation / Ruggedness sliders (whole numbers, as on the page)
//   owz                              wild zones on
//   osc                              s = Standard canvas (800x600), c = Continent canvas (1600x1200)
//   wx, wy, ww                       the window's left, top and width as fractions of the overworld
//                                    (the map is 4:3, so the height is the same fraction: always 4:3)
//
// This file holds the pure parts (reading/writing that address, and reading fields out of a built
// world at the window's coordinates), so Node can test them. The page draws from what it returns.

const MapWindow = (function () {
  const DETAIL_W = 800, DETAIL_H = 600;       // the detail map's canvas
  const MAX_ZOOM = 12;                        // 1/12 of the overworld across
  const WARN_ZOOM = 8;                        // beyond this the overworld's own cells run out of detail to show
  const CONTINENT_CELLS = 70000;              // mirrors lib/overworld-world.js's tier threshold

  const num = (raw, fallback, lo, hi) => {
    const n = parseFloat(raw);
    return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : fallback;
  };
  const int = (raw, fallback, lo, hi) => Math.round(num(raw, fallback, lo, hi));
  const flag = (raw, fallback) => (raw === null || raw === undefined || raw === '' ? fallback : raw === '1' || raw === 'true');

  // Snaps a requested rectangle to something the map can show: width between 1/MAX_ZOOM and 1, and
  // fully inside the overworld. Four decimals keeps the address short and the window repeatable.
  function clamp(wx, wy, ww) {
    const w = Math.round(Math.max(1 / MAX_ZOOM, Math.min(1, Number.isFinite(ww) ? ww : 0.25)) * 10000) / 10000;
    const x = Math.round(Math.max(0, Math.min(1 - w, Number.isFinite(wx) ? wx : 0)) * 10000) / 10000;
    const y = Math.round(Math.max(0, Math.min(1 - w, Number.isFinite(wy) ? wy : 0)) * 10000) / 10000;
    return { wx: x, wy: y, ww: w };
  }

  // Reads a window from URL parameters (anything with .get). null when the address is not a window.
  function parse(params) {
    if (!params || typeof params.get !== 'function') return null;
    if (params.get('ww') === null || params.get('ww') === undefined || params.get('ww') === '') return null;
    const box = clamp(parseFloat(params.get('wx')), parseFloat(params.get('wy')), parseFloat(params.get('ww')));
    const continent = params.get('osc') === 'c';
    return {
      seed: int(params.get('seed'), 1, 1, 2147483646),
      cells: int(params.get('oc'), continent ? 150000 : 40000, 1000, 300000),
      octaves: int(params.get('oo'), 4, 1, 6),
      island: flag(params.get('oi'), true),
      rivers: flag(params.get('orv'), true),
      settle: int(params.get('os'), 6, 0, 60),
      sea: num(params.get('sea'), 0.42, 0, 1),
      forestBias: int(params.get('ofb'), 0, -100, 100),
      ruggedBias: int(params.get('orb'), 0, -100, 100),
      wildZones: flag(params.get('owz'), true),
      continent,
      wx: box.wx, wy: box.wy, ww: box.ww,
    };
  }

  // The address for a window, in a fixed order so the same window always gives the same text.
  function toParams(win) {
    const box = clamp(win.wx, win.wy, win.ww);
    return [
      ['seed', win.seed], ['oc', win.cells], ['oo', win.octaves], ['oi', win.island ? 1 : 0], ['orv', win.rivers ? 1 : 0],
      ['os', win.settle], ['sea', win.sea], ['ofb', win.forestBias], ['orb', win.ruggedBias], ['owz', win.wildZones ? 1 : 0],
      ['osc', win.continent ? 'c' : 's'], ['wx', box.wx], ['wy', box.wy], ['ww', box.ww],
    ].map(([k, v]) => `${k}=${v}`).join('&');
  }

  // The overworld canvas this window's world is laid out on.
  function canvasFor(win) { return win.continent ? { width: 1600, height: 1200 } : { width: 800, height: 600 }; }

  // The numbers lib/overworld-world.js builds the world from.
  function worldParams(win) {
    return { seed: win.seed, cellCount: win.cells, octaves: win.octaves, island: win.island, seaLevel: win.sea, riversOn: win.rivers, settleCount: win.settle };
  }

  function zoomOf(win) { return 1 / win.ww; }

  // How many of the overworld's own cells span the window. Below about 40 the map is mostly invented detail.
  function cellsAcross(win, world) { return win.ww * world.cols; }

  // Bilinear read of a cols x rows grid at fractional cell coordinates (cell centres sit at integers).
  function bilinear(arr, cols, rows, fx, fy) {
    const x0 = Math.max(0, Math.min(cols - 1, Math.floor(fx)));
    const y0 = Math.max(0, Math.min(rows - 1, Math.floor(fy)));
    const x1 = Math.min(cols - 1, x0 + 1), y1 = Math.min(rows - 1, y0 + 1);
    const tx = Math.max(0, Math.min(1, fx - x0)), ty = Math.max(0, Math.min(1, fy - y0));
    const top = arr[y0 * cols + x0] * (1 - tx) + arr[y0 * cols + x1] * tx;
    const bot = arr[y1 * cols + x0] * (1 - tx) + arr[y1 * cols + x1] * tx;
    return top * (1 - ty) + bot * ty;
  }

  // Reads fields out of a built world at the window's detail coordinates. (u, v) are fractions of the
  // detail canvas, 0..1 across and down; the overworld point is wx + u*ww (of its width), wy + v*ww
  // (of its height).
  function sampler(world, win) {
    const dim = canvasFor(win);
    const ox = win.wx * dim.width, oy = win.wy * dim.height;
    const spanX = win.ww * dim.width, spanY = win.ww * dim.height;
    const { cols, rows, cellW, cellH } = world;
    const toX = (u) => ox + u * spanX, toY = (v) => oy + v * spanY;
    const field = (arr) => (u, v) => bilinear(arr, cols, rows, toX(u) / cellW - 0.5, toY(v) / cellH - 0.5);

    // Lakes as the overworld paints them: a lake cell with a little flow through it.
    let lakeMask = null;
    if (world.isLake && world.flow) {
      lakeMask = new Float32Array(cols * rows);
      for (let i = 0; i < lakeMask.length; i++) lakeMask[i] = world.isLake[i] && world.flow[i] >= 2 ? 1 : 0;
    }

    const nearest = (u, v) => {
      const gx = Math.max(0, Math.min(cols - 1, Math.floor(toX(u) / cellW)));
      const gy = Math.max(0, Math.min(rows - 1, Math.floor(toY(v) / cellH)));
      return gy * cols + gx;
    };

    // The overworld's rolled wild zones that reach into this window, one entry per zone with a
    // per-detail-cell mask of the cells inside the region (or mountain range) it was rolled for. A zone
    // with no cell in the window is left out. `mesh` is the detail map's own cell grid.
    function zoneEntries(mesh, enabled) {
      if (!enabled) return [];
      const entries = [];
      const add = (zone, test) => {
        const mask = new Uint8Array(mesh.cells.length);
        let any = false;
        mesh.cells.forEach((cell, i) => {
          if (test(nearest(cell.x / mesh.width, cell.y / mesh.height))) { mask[i] = 1; any = true; }
        });
        if (any) entries.push({ zone, mask });
      };
      (world.regionZoneOf || []).forEach((zone, r) => { if (zone) add(zone, (idx) => world.regionOf[idx] === r); });
      (world.rangeZoneOf || []).forEach((zone, k) => { if (zone) add(zone, (idx) => !!world.rangeIndexOf && world.rangeIndexOf[idx] === k); });
      return entries;
    }

    return {
      win, dim, cols, rows, zoneEntries,
      heightAt: field(world.heights),
      moistureAt: field(world.mOf),
      temperatureAt: field(world.tOf),
      lakeAt: lakeMask ? field(lakeMask) : null,
      nearest,
      // Overworld pixel -> detail pixel, and the reverse.
      toDetail: (x, y) => ({ x: ((x - ox) / spanX) * DETAIL_W, y: ((y - oy) / spanY) * DETAIL_H }),
      toOverworld: (px, py) => ({ x: ox + (px / DETAIL_W) * spanX, y: oy + (py / DETAIL_H) * spanY }),
      // Overworld pixels per detail pixel (how much finer the detail map is than the overworld).
      scale: spanX / DETAIL_W,
    };
  }

  // The overworld's river network as polylines, source to mouth, in OVERWORLD pixels, each point with
  // the flow through it. Same walk the overworld uses to draw them (a source is a qualifying cell with
  // no qualifying cell draining into it; walk downhill, stop at the sea, a merge, or when the flow
  // gives out), so a river drawn here is the river the overworld shows. `factor` below 1 lowers the
  // threshold to include smaller streams, which the overworld leaves out but whose flow it does hold.
  function riverChains(world, factor) {
    if (!world.flow || !world.downhill) return [];
    const n = world.flow.length;
    const thr = world.riverThreshold * (factor === undefined ? 1 : factor);
    const hasUpstream = new Uint8Array(n);
    for (let i = 0; i < n; i++) if (world.flow[i] >= thr && world.downhill[i] !== -1) hasUpstream[world.downhill[i]] = 1;
    const visited = new Uint8Array(n);
    const sea = world.seaLevel;
    const chains = [];
    for (let s = 0; s < n; s++) {
      if (world.flow[s] < thr || hasUpstream[s]) continue;
      const pts = [{ x: world.mesh.cells[s].x, y: world.mesh.cells[s].y, flow: world.flow[s], h: world.heights[s] }];
      let cur = s;
      for (;;) {
        const next = world.downhill[cur];
        if (next === -1) break;
        pts.push({ x: world.mesh.cells[next].x, y: world.mesh.cells[next].y, flow: world.flow[next], h: world.heights[next] });
        if (visited[next]) break;
        visited[next] = 1;
        if (world.heights[next] < sea || world.flow[next] < thr) break;
        cur = next;
      }
      // The overworld walks one step into the sea; zoomed in, that step is a long tail across open water,
      // so a river that ends in the sea is cut where it crosses the shore.
      const last = pts[pts.length - 1], prev = pts[pts.length - 2];
      if (pts.length >= 2 && last.h < sea && prev.h >= sea) {
        const t = (prev.h - sea) / (prev.h - last.h);
        pts[pts.length - 1] = { x: prev.x + (last.x - prev.x) * t, y: prev.y + (last.y - prev.y) * t, flow: last.flow, h: sea };
      }
      if (pts.length >= 2) chains.push({ points: pts, maxFlow: Math.max.apply(null, pts.map((p) => p.flow)) });
    }
    return chains;
  }

  return { DETAIL_W, DETAIL_H, MAX_ZOOM, WARN_ZOOM, CONTINENT_CELLS, clamp, parse, toParams, canvasFor, worldParams, zoomOf, cellsAcross, bilinear, sampler, riverChains };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = MapWindow;
