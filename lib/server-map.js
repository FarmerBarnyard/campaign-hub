// Server-rendered maps: the browser asks the Worker (POST /campaign/map/generate)
// for a rules-checked render from the mapgen service instead of drawing it
// locally. The Worker caches every result in R2 by a hash of the request, so
// asking for the same map twice is instant and costs nothing.
//
// Browser-only: the mapgen service loads the generator files, not this one, so
// nothing here may be reached from a generator's render path -- only from
// event handlers.
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
  loadImage(path) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('image_load_failed'));
      img.src = API_BASE + path;
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
