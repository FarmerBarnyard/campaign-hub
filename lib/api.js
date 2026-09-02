// Campaign Hub's public API lives on the shared Worker at api.barnyard.site,
// under the /campaign prefix (alongside that Worker's other routes:
// /price, /calendar, /generate-notes). This is a different origin than
// campaign.barnyard.site, so every call here is cross-origin -- the Worker
// handles CORS + Origin enforcement, same pattern as /generate-notes.
const API_BASE = 'https://api.barnyard.site/campaign';

// 401 vs 403 are genuinely different states for a write call: not logged in
// at all, vs logged in but missing the campaign-hub-users AD group. `code`
// lets every call site show the right message without each one re-deriving
// it from res.status -- see the Worker's own requireSession for the
// server-side side of this distinction.
function errorCodeForStatus(status) {
  if (status === 401) return 'unauthenticated';
  if (status === 403) return 'forbidden';
  return null;
}

const Api = {
  async get(path) {
    const res = await fetch(API_BASE + path);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error || 'request_failed');
      err.status = res.status;
      err.data = data;
      err.code = errorCodeForStatus(res.status);
      throw err;
    }
    return data;
  },
  async post(path, body) {
    const res = await fetch(API_BASE + path, {
      method: 'POST',
      // Required now that the four write routes check a login session --
      // without this the browser never sends the session cookie
      // cross-origin at all, and every write 401s regardless of login state
      // (2026-09-02 security review, M2). GET stays uncredentialed -- reads
      // are deliberately not gated (see the Worker's /auth/* section).
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error || 'request_failed');
      err.status = res.status;
      err.data = data;
      err.code = errorCodeForStatus(res.status);
      throw err;
    }
    return data;
  },
};
