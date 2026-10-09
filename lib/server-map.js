// Server-rendered maps: the browser asks the Worker (POST /campaign/map/generate)
// for a rules-checked render from the mapgen service instead of drawing it
// locally. The Worker caches every result in R2 by a hash of the request, so
// asking for the same map twice is instant and costs nothing.
//
// The mapgen service loads this file too (the views call toggleHtml/attach while they set up), where
// those two are inert against its container stubs. Everything that touches the network (render,
// loadImage) is reached only from event handlers, never from a generator's render path.
const ServerMap = {
  // `type` is settlement|dungeon|detail|landmark|overworld; `params` are the
  // same URL-style params the in-browser view parses. Throws the same
  // `.code`/`.data.error` shape Api.post does.
  async render({ type, params, scale = 2, theme }) {
    return Api.post('/map/generate', { type, params, scale, theme });
  },

  // Loads a Worker-served map image so it can be drawn onto a canvas AND read
  // back (export / save). `crossOrigin` matters twice over: the Worker rejects
  // any /campaign/* request without an allowed Origin header, which a plain
  // cross-origin <img> never sends, and a canvas drawn from an image without
  // CORS approval is tainted and cannot be exported.
  //
  // `path` is exactly what the Worker returned (displayUrl / masterUrl): an
  // origin-relative path that already begins "/campaign/...", NOT relative to
  // API_BASE (which itself ends in /campaign). Resolving it against API_BASE
  // as a URL gives https://api.barnyard.site/campaign/map/cached?...; plain
  // string concatenation would double the prefix and 404.
  loadImage(path) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('image_load_failed'));
      img.src = new URL(path, API_BASE).href;
    });
  },

  // The notable-locations panel arrives as the generator's own HTML
  // (`meta.poi`). Only the text of its <p> entries is used, rebuilt as DOM
  // nodes, so no markup from the server ever reaches innerHTML.
  poiLabels(meta) {
    const html = meta && typeof meta.poi === 'string' ? meta.poi : '';
    if (!html) return [];
    const doc = new DOMParser().parseFromString(html, 'text/html');
    return Array.from(doc.querySelectorAll('p'), (p) => p.textContent.trim()).filter(Boolean);
  },

  // The checkbox every map page offers, for views/map-detail.js, map-window.js, map-landmark.js and
  // map-dungeon.js (the settlement page wires its own, with the rules report). The ids follow the view's
  // prefix: `#dt-server`, `#dt-server-status`.
  toggleHtml(prefix) {
    return `<label><input type="checkbox" id="${prefix}-server"> Render on server (cached)</label>
        <p id="${prefix}-server-status" class="status-text"></p>`;
  },

  // Fills a panel with the generator's own markup without trusting it: the HTML is parsed inertly and only
  // a few text-level tags (and their plain class names) are rebuilt as DOM nodes, so nothing from the
  // network reaches innerHTML.
  fillPanel(el, html) {
    const ALLOWED = new Set(['H3', 'P', 'UL', 'LI', 'STRONG', 'EM', 'SPAN', 'BR']);
    const copy = (from, into) => {
      for (const node of Array.from(from.childNodes)) {
        if (node.nodeType === 3) { into.appendChild(document.createTextNode(node.textContent)); continue; }
        if (node.nodeType !== 1) continue;
        if (node.tagName === 'SCRIPT' || node.tagName === 'STYLE') continue;   // their text is code, not content
        if (!ALLOWED.has(node.tagName)) { copy(node, into); continue; }
        const out = document.createElement(node.tagName.toLowerCase());
        const cls = node.getAttribute('class');
        if (cls && /^[\w -]{1,60}$/.test(cls)) out.className = cls;
        copy(node, out);
        into.appendChild(out);
      }
    };
    el.textContent = '';
    if (typeof html !== 'string' || !html) return;
    copy(new DOMParser().parseFromString(html, 'text/html').body, el);
  },

  // Adds the "Render on server" behaviour to a map page: ticking the box draws the Worker's cached,
  // rendered copy of this same map over the canvas; unticking (or any failure) goes back to the in-browser
  // render, so the page always ends up showing a map.
  //
  //   prefix     view id prefix (`dt`, `lm`, `dg`), matching `toggleHtml`
  //   type       the mapgen type to request
  //   params     () => the URL-style params for this map (what the server needs to draw the same map)
  //   theme      () => the chosen theme key
  //   regenerate () => draws the map in the browser (called on untick and on failure)
  //   onResult   (response) => optional, e.g. to fill the room key from `meta.meta`
  //
  // Returns `{ active(), refresh(), drawMaster(offCtx) }`: `refresh` re-renders after a theme change while
  // server mode is on, and `drawMaster` paints the stored 2x master for an export (false when server mode
  // is off, so the caller redraws locally).
  attach({ container, prefix, canvas, type, params, theme, regenerate, onResult }) {
    const box = container.querySelector(`#${prefix}-server`);
    const statusEl = container.querySelector(`#${prefix}-server-status`);
    let result = null;
    let requestId = 0;

    async function run() {
      const mine = ++requestId;
      const progress = showGenerationProgress(canvas, 'Rendering on server…');
      statusEl.textContent = '';
      try {
        const res = await ServerMap.render({ type, params: params(), scale: 2, theme: theme() });
        const img = await ServerMap.loadImage(res.displayUrl);
        if (mine !== requestId) return;   // superseded, or the box was unticked
        const c = canvas.getContext('2d');
        c.clearRect(0, 0, canvas.width, canvas.height);
        c.drawImage(img, 0, 0, canvas.width, canvas.height);
        result = res;
        if (onResult) onResult(res);
        statusEl.textContent = res.cached ? 'Loaded from cache.' : 'Rendered on server.';
      } catch (e) {
        if (mine !== requestId) return;
        box.checked = false;
        result = null;
        statusEl.textContent = ServerMap.describeError(e);
        await regenerate();
      } finally {
        progress.done();
      }
    }

    box.addEventListener('change', () => {
      if (box.checked) { run(); return; }
      requestId++;
      result = null;
      statusEl.textContent = '';
      regenerate();
    });

    return {
      active: () => !!result,
      refresh: () => { if (result) run(); },
      async drawMaster(offCtx) {
        if (!result) return false;
        const master = await ServerMap.loadImage(result.masterUrl);
        offCtx.drawImage(master, 0, 0, canvas.width, canvas.height);
        return true;
      },
    };
  },

  // One line the user can act on, for any failure from render().
  describeError(e) {
    if (e.code === 'unauthenticated') return 'Log in (top of page) to render maps on the server.';
    if (e.code === 'forbidden') return "You're logged in, but don't have access to server rendering.";
    const code = e.data && e.data.error;
    if (code === 'busy') return 'The renderer is busy -- try again in a few seconds.';
    if (code === 'daily_cap_reached') return 'Daily server-render limit reached. The in-browser map still works.';
    if (code === 'invalid_map_request') return 'This map link has parameters the server cannot render.';
    return 'Server rendering is unavailable right now -- the in-browser map still works.';
  },
};
