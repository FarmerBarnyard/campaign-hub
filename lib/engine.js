// The Campaign page's side of the campaign engine: queue a note or a pack of notes, watch the job,
// review the drafts, save the ones you want (see the Worker's /campaign/jobs/* routes and the
// engine/ service in ClaudeRepo). The model runs at a few tokens a second, so generation is a
// background job you come back to, not a request that waits.
//
// This file holds the pure helpers (wording, paths, polling rules; require()-able from Node for
// the tests in test/engine.test.js) and the thin API calls. The screen itself is views/jobs.js.
// Anything a model wrote is only ever shown with textContent, never as markup.

const EngineHelpers = (function () {
  const POLL_MS = 3000;
  const ACTIVE = { queued: true, running: true };

  function isActive(job) { return !!job && !!ACTIVE[job.state]; }

  // One line for a job's state: what a person wants to know at a glance.
  function stateText(job) {
    if (!job) return '';
    if (job.state === 'queued') return 'Waiting for the engine…';
    if (job.state === 'running') {
      const label = job.cancelling ? 'Stopping…' : (job.label || 'Working…');
      return job.total ? `${label} (${job.done + job.failed} of ${job.total})` : label;
    }
    if (job.state === 'done') {
      const parts = [`${job.done} written`];
      if (job.failed) parts.push(`${job.failed} could not be written`);
      return parts.join(', ');
    }
    if (job.state === 'cancelled') return job.done ? `Stopped, ${job.done} written` : 'Stopped';
    return job.error || 'Something went wrong';
  }

  // 0..1 for the bar; a job with no plan yet shows nothing moving.
  function fraction(job) {
    if (!job || !job.total) return job && job.state === 'done' ? 1 : 0;
    return Math.max(0, Math.min(1, (job.done + job.failed) / job.total));
  }

  function elapsedText(startMs, nowMs) {
    if (!startMs) return '';
    const s = Math.max(0, Math.round((nowMs - startMs) / 1000));
    if (s < 60) return `${s} s`;
    const m = Math.floor(s / 60);
    return m < 60 ? `${m} min ${s % 60 ? (s % 60) + ' s' : ''}`.trim() : `${Math.floor(m / 60)} h ${m % 60} min`;
  }

  // A name that is safe as a folder or file name: no slashes, no characters Windows or Obsidian dislike.
  function safeName(s, fallback) {
    const t = String(s === undefined || s === null ? '' : s).replace(/[\\/:*?"<>|#^\[\]\u0000-\u001f]/g, ' ').replace(/\.{2,}/g, ' ').replace(/\s+/g, ' ').trim().replace(/^\.+/, '');
    return (t || fallback || '').slice(0, 80);
  }

  // The folder a draft is filed under: the kind's own template, with {location} filled from the
  // draft's Location field when it has one and anything else left as "Misc".
  function folderFor(schema, frontmatter) {
    const template = (schema && schema.folderTemplate) || 'Misc';
    return template.split('/').map((seg) => seg.replace(/\{([^}]+)\}/g, (m, key) => (
      key === 'location' && frontmatter && frontmatter.Location ? safeName(frontmatter.Location, 'Misc') : 'Misc'
    ))).join('/');
  }

  function filenameFor(title) { return safeName(title, 'Untitled') + '.md'; }

  // The path a draft is saved at; `n` > 1 numbers a name that is already taken ("Title (2).md").
  function pathFor(folder, title, n) {
    const base = safeName(title, 'Untitled');
    return `${folder.replace(/^\/+|\/+$/g, '') || 'Misc'}/${n > 1 ? `${base} (${n})` : base}.md`;
  }

  // What to tell the person when the Worker refuses something.
  function errorText(err) {
    const code = err && (err.data && err.data.error);
    if (err && err.code === 'unauthenticated') return 'Log in (top of page) to use the engine.';
    if (err && err.code === 'forbidden') return "You're logged in, but don't have access to the engine.";
    if (code === 'engine_disabled') return 'The engine is switched off.';
    if (code === 'daily_cap_reached') return err.data.left ? `Not enough of today's allowance left (${err.data.left} notes). Try a smaller pack or wait until tomorrow.` : "Today's allowance of generated notes is used up. Try again tomorrow.";
    if (code === 'too_many_jobs') return 'You already have several jobs waiting or running. Let one finish, or cancel one.';
    if (code === 'queue_full') return 'The queue is full right now. Try again in a few minutes.';
    if (code === 'campaign_not_found') return 'That campaign no longer exists.';
    if (code === 'premise_required') return 'Write a premise first.';
    if (code === 'brief_required') return 'Write a brief first.';
    if (code && /_too_long$/.test(code)) return 'That is too long. Shorten it and try again.';
    if (code) return `That did not work (${String(code).replace(/_/g, ' ')}).`;
    return "Couldn't reach the server. Try again.";
  }

  // Is the engine usable right now? -> {use: bool, reason}
  function engineUsable(status) {
    if (!status || !status.enabled) return { use: false, reason: 'off' };
    if (!status.engine || !status.engine.online) return { use: false, reason: 'offline' };
    return { use: true, reason: '' };
  }

  return { POLL_MS, isActive, stateText, fraction, elapsedText, safeName, folderFor, filenameFor, pathFor, errorText, engineUsable };
})();

const EngineApi = {
  status() { return Api.get('/jobs/status'); },
  list(campaign) { return Api.get(`/jobs/list?campaign=${encodeURIComponent(campaign)}`); },
  get(id, since) { return Api.get(`/jobs/get?id=${encodeURIComponent(id)}${since !== undefined ? '&since=' + since : ''}`); },
  createNote(campaign, kind, brief, hints, tone) { return Api.post('/jobs/create', { campaign, type: 'note', kind, brief, hints: hints || {}, tone: tone || '' }); },
  createPack(campaign, premise, tone, size, kinds, existingTitles) {
    return Api.post('/jobs/create', { campaign, type: 'pack', premise, tone: tone || '', size, kinds, existingTitles: existingTitles || [] });
  },
  cancel(id) { return Api.post('/jobs/cancel', { id }); },
  remove(id) { return Api.post('/jobs/delete', { id }); },
};

if (typeof module !== 'undefined' && module.exports) module.exports = EngineHelpers;
