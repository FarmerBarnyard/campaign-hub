// "Zoom to an area" on the overworld page: pick a rectangle of the map and open it as a zoomed map
// (lib/map-window.js / views/map-window.js).
//
// With the tool on, drag a box on the map, or click to drop one of the chosen zoom centred on the click.
// The box keeps the map's 4:3 shape. From the keyboard (the map takes focus): arrows move it, + and -
// change the zoom, Enter opens it, Escape puts the tool away. The geometry itself is in lib/map-window.js
// (fromDrag, fromCentre, nudge, withZoom), which has the tests; this file only listens and draws.
//
// hooks: {
//   settings()      the overworld settings the map on screen was drawn with (see MapWindow.toParams), or null
//   cellsAcross(w)  how many of the overworld's own cells span a window (optional, for the depth warning)
//   open(win)       go to the zoomed map for this window
// }
// Returns { reset, show, isActive }.
function wireZoomSelect(container, canvas, hooks) {
  const toolBtn = container.querySelector('#ow-zoom-tool');
  const levelSel = container.querySelector('#ow-zoom-level');
  const goBtn = container.querySelector('#ow-zoom-go');
  const statusEl = container.querySelector('#ow-zoom-status');
  const boxEl = container.querySelector('#ow-select-box');
  const wrap = canvas.parentElement;

  let active = false;
  let current = null;   // the box: { wx, wy, ww }
  let drag = null;

  function pointOf(evt) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: (evt.clientX - rect.left - canvas.clientLeft) * (canvas.width / canvas.clientWidth),
      y: (evt.clientY - rect.top - canvas.clientTop) * (canvas.height / canvas.clientHeight),
    };
  }

  function chosenZoom() {
    const z = parseFloat(levelSel.value);
    return Number.isFinite(z) ? z : 4;
  }

  function draw() {
    if (!current) { boxEl.hidden = true; return; }
    const sx = canvas.clientWidth / canvas.width, sy = canvas.clientHeight / canvas.height;
    boxEl.hidden = false;
    boxEl.style.left = `${canvas.clientLeft + current.wx * canvas.width * sx}px`;
    boxEl.style.top = `${canvas.clientTop + current.wy * canvas.height * sy}px`;
    boxEl.style.width = `${current.ww * canvas.width * sx}px`;
    boxEl.style.height = `${current.ww * canvas.height * sy}px`;
  }

  function describe() {
    if (!current) {
      statusEl.textContent = active ? 'Drag a box on the map, or click to place one. Arrow keys move it, + and - zoom, Enter opens it.' : '';
      goBtn.disabled = true;
      return;
    }
    const zoom = 1 / current.ww;
    const settings = hooks.settings();
    const across = settings && hooks.cellsAcross ? hooks.cellsAcross(Object.assign({}, settings, current)) : null;
    let text = `Zoom ${zoom.toFixed(zoom % 1 ? 1 : 0)}x.`;
    if (zoom > MapWindow.WARN_ZOOM || (across !== null && across < 40)) text += ' Deeper than the map recorded: the extra detail will be added texture.';
    statusEl.textContent = text;
    goBtn.disabled = !settings;
  }

  function setBox(box, fromDrag) {
    current = box;
    const zoom = 1 / box.ww;
    const match = MapWindow.ZOOM_LEVELS.find((z) => Math.abs(z - zoom) < 0.02);
    if (fromDrag && !match) levelSel.value = 'custom';
    else if (match) levelSel.value = String(match);
    draw();
    describe();
  }

  function setActive(on) {
    active = on;
    toolBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
    toolBtn.textContent = on ? 'Stop selecting' : 'Select an area…';
    wrap.classList.toggle('selecting', on);
    if (on) { canvas.tabIndex = 0; canvas.focus(); } else canvas.removeAttribute('tabindex');
    describe();
  }

  function open() {
    const settings = hooks.settings();
    if (!current || !settings) return;
    hooks.open(Object.assign({}, settings, current));
  }

  toolBtn.addEventListener('click', () => setActive(!active));
  goBtn.addEventListener('click', open);
  levelSel.addEventListener('change', () => {
    const zoom = parseFloat(levelSel.value);
    if (!Number.isFinite(zoom)) return;
    if (current) setBox(MapWindow.withZoom(current, zoom), false);
    else if (active) { statusEl.textContent = `Click the map to place a ${zoom}x box.`; }
  });

  // The page's own click handler (offers a town, landmark or "zoom here" button) must not also fire
  // while a box is being placed, so this runs first and swallows the click.
  canvas.addEventListener('click', (evt) => { if (active) evt.stopImmediatePropagation(); }, true);

  canvas.addEventListener('pointerdown', (evt) => {
    if (!active || (evt.pointerType === 'mouse' && evt.button !== 0)) return;
    evt.preventDefault();
    // Keeps the drag going if the pointer leaves the map; harmless if the browser will not capture it.
    try { canvas.setPointerCapture(evt.pointerId); } catch (e) { /* not capturable */ }
    drag = { start: pointOf(evt), moved: false };
  });
  canvas.addEventListener('pointermove', (evt) => {
    if (!drag) return;
    const here = pointOf(evt);
    if (!drag.moved && Math.hypot(here.x - drag.start.x, here.y - drag.start.y) < 6) return;
    drag.moved = true;
    setBox(MapWindow.fromDrag(drag.start, here, canvas.width, canvas.height), true);
  });
  const endDrag = (evt) => {
    if (!drag) return;
    const wasClick = !drag.moved;
    const start = drag.start;
    drag = null;
    if (wasClick && evt.type === 'pointerup') setBox(MapWindow.fromCentre(start.x, start.y, chosenZoom(), canvas.width, canvas.height), false);
  };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);

  canvas.addEventListener('keydown', (evt) => {
    if (!active) return;
    const step = 0.05;
    const move = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[evt.key];
    const levels = MapWindow.ZOOM_LEVELS;
    if (move || evt.key === '+' || evt.key === '=' || evt.key === '-' || evt.key === '_') {
      evt.preventDefault();
      if (!current) current = MapWindow.fromCentre(canvas.width / 2, canvas.height / 2, chosenZoom(), canvas.width, canvas.height);
      if (move) current = MapWindow.nudge(current, move[0], move[1]);
      else {
        const zoom = 1 / current.ww;
        const dir = evt.key === '+' || evt.key === '=' ? 1 : -1;
        const next = dir > 0 ? levels.find((z) => z > zoom + 0.02) : levels.slice().reverse().find((z) => z < zoom - 0.02);
        if (next) current = MapWindow.withZoom(current, next);
      }
      setBox(current, false);
    } else if (evt.key === 'Enter') {
      evt.preventDefault();
      open();
    } else if (evt.key === 'Escape') {
      evt.preventDefault();
      current = null;
      draw();
      setActive(false);
    }
  });

  // Keep the box lined up when the map is resized; stop listening once the page has been replaced.
  const onResize = () => {
    if (!canvas.isConnected) { window.removeEventListener('resize', onResize); return; }
    draw();
  };
  if (typeof window.addEventListener === 'function') window.addEventListener('resize', onResize);

  return {
    // Called when the map is redrawn from different settings: the old box no longer fits it.
    reset() { current = null; drag = null; draw(); describe(); },
    // Shows a box without turning the tool on (coming back from a zoomed map).
    show(box) { setBox(box, true); },
    isActive() { return active; },
  };
}
