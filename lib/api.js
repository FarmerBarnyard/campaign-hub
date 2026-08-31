// Campaign Hub's public API lives on the shared Worker at api.barnyard.site,
// under the /campaign prefix (alongside that Worker's other routes:
// /price, /calendar, /generate-notes). This is a different origin than
// campaign.barnyard.site, so every call here is cross-origin -- the Worker
// handles CORS + Origin enforcement, same pattern as /generate-notes.
const API_BASE = 'https://api.barnyard.site/campaign';

const Api = {
  async get(path) {
    const res = await fetch(API_BASE + path);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error || 'request_failed');
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  },
  async post(path, body) {
    const res = await fetch(API_BASE + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error || 'request_failed');
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  },
};
