// Reusable generation-progress overlay -- added because the WotC-style
// pictorial pass this file is part of is expected to push single-map
// generation time up materially (per the account owner's own "I don't
// mind how long it take to load"), and a fully synchronous multi-second
// generate() call leaves the tab looking frozen with no feedback at all.
// Threshold-gated (GEN_PROGRESS_SHOW_DELAY_MS) so a normal, still-fast
// generation never flickers a bar for a fraction of a second.

const GEN_PROGRESS_SHOW_DELAY_MS = 450;

// Yields one tick to the browser's paint/event loop -- the exact technique
// views/map-overworld.js's "Export all maps" batch loop already uses
// (setTimeout(resolve, 0)), reused here so a generate() function broken
// into stages can actually let the progress bar (and the rest of the
// page) repaint between them instead of blocking the whole time.
function yieldToPaint() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

// canvas: the view's own canvas element (its parent is assumed to be the
// `.map-layout` flex container every generator already uses). Returns a
// controller: { update(fraction, message), done() }. Safe to call even if
// a previous overlay on the same canvas is still up.
function showGenerationProgress(canvas, label) {
  const layout = canvas.parentElement;
  if (!layout) return { update() {}, done() {} };
  const existing = layout.querySelector('.gen-progress-overlay');
  if (existing) existing.remove();

  const el = document.createElement('div');
  el.className = 'gen-progress-overlay';
  el.style.display = 'none';
  el.style.left = canvas.offsetLeft + 'px';
  el.style.top = Math.max(0, canvas.offsetTop + canvas.offsetHeight - 44) + 'px';
  el.style.width = Math.max(120, canvas.offsetWidth - 16) + 'px';
  el.innerHTML = `<div class="gen-progress-label"></div><div class="gen-progress-track"><div class="gen-progress-fill"></div></div>`;
  layout.appendChild(el);

  const labelEl = el.querySelector('.gen-progress-label');
  const fillEl = el.querySelector('.gen-progress-fill');
  labelEl.textContent = label || 'Generating…';

  const showTimer = setTimeout(() => { el.style.display = ''; }, GEN_PROGRESS_SHOW_DELAY_MS);

  return {
    update(fraction, message) {
      fillEl.style.width = `${Math.round(Math.max(0, Math.min(1, fraction)) * 100)}%`;
      if (message) labelEl.textContent = message;
    },
    done() {
      clearTimeout(showTimer);
      el.remove();
    },
  };
}
