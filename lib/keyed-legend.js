// Numbered-badge + text-legend convention -- generalizes the room-key
// pattern views/map-dungeon.js already established (a small on-canvas
// number + a DOM legend panel below the map) so any generator's named
// locations can use the same real-world-map convention confirmed directly
// against WotC's own Daggerford map: notable buildings are marked with a
// small number on the map itself, never a floating text label, with the
// actual name only appearing in a text key.

// Small filled circle + centered numeral -- deliberately plain (matches
// this app's existing icon-dispatcher convention: flat single-tone,
// ink-colored, no shading) since the badge is a wayfinding mark, not a
// pictorial element in its own right.
function drawNumberedBadge(ctx, x, y, num, opts) {
  const { fill, ink, radius } = opts;
  const r = radius || 7;
  ctx.save();
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = ink;
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = ink;
  ctx.font = `bold ${Math.round(r * 1.15)}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(num), x, y + 0.5);
  ctx.restore();
}

// container: the view's own root element. selector: e.g. '#st-poi'.
// heading: panel title, e.g. "Notable locations". entries: [{number,
// label}], already in the order they should list. Mirrors
// views/map-dungeon.js's own '.dungeon-key' population exactly (same
// markup shape), so the shared CSS in styles.css applies unchanged.
function renderKeyLegendPanel(container, selector, heading, entries) {
  const el = container.querySelector(selector);
  if (!el) return;
  if (!entries.length) { el.innerHTML = ''; return; }
  el.innerHTML = `<h3>${heading}</h3>` + entries.map((e) =>
    `<p class="key-room"><span class="key-room-num">${e.number}</span> ${e.label}</p>`
  ).join('');
}
