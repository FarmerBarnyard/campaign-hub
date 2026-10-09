// The engine's screen: a pack form, the campaign's jobs with live progress, and a review list for
// the drafts (see lib/engine.js and the Worker's /campaign/jobs/* routes). Nothing a model wrote
// is ever put in the page as markup: titles and bodies go in with textContent / .value only.
//
//   renderJobsPanel(container, campaign, schemas)   below the "+ New ..." buttons on a campaign
//   runNoteJob(opts)                                 used by the New note page's Generate button

const PACK_KINDS = ['Location', 'Entity', 'Quest', 'Item', 'Religion'];
const PACK_SIZES = [['small', 'Small (6 notes)'], ['medium', 'Medium (12 notes)'], ['large', 'Large (24 notes)']];
const SAVED_KEY = 'campaign-engine-saved';

function jobEl(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined && text !== null) e.textContent = text;
  return e;
}

function savedSet() {
  try { return new Set(JSON.parse(sessionStorage.getItem(SAVED_KEY) || '[]')); } catch (e) { return new Set(); }
}
function rememberSaved(set) {
  try { sessionStorage.setItem(SAVED_KEY, JSON.stringify([...set].slice(-400))); } catch (e) { /* the page works without it */ }
}

// The titles already in a campaign, so a pack can link to them and never reuse one. A bounded walk
// of the folder listing; anything that fails just means fewer titles.
async function collectCampaignTitles(campaign) {
  const titles = [];
  let requests = 0;
  async function walk(relPath) {
    if (requests >= 25 || titles.length >= 150) return;
    requests++;
    let listing;
    try { listing = await Api.get(`/list?campaign=${encodeURIComponent(campaign)}&path=${encodeURIComponent(relPath)}`); } catch (e) { return; }
    for (const f of listing.files || []) if (f.name.endsWith('.md') && titles.length < 150) titles.push(f.name.replace(/\.md$/, ''));
    for (const d of listing.dirs || []) await walk(relPath ? `${relPath}/${d}` : d);
  }
  await walk('');
  return titles.filter((t) => t && !/[\[\]|]/.test(t) && t.length <= 120);
}

// ---- a single note, for the New note page ----------------------------------------------------------------
//
// Queues the job and watches it. opts: {campaign, kind, brief, hints, tone, onStatus(text)}.
// -> {promise, cancel()}; the promise resolves to {title, frontmatter, body} or rejects with an Error
// whose message is one plain sentence.
function runNoteJob(opts) {
  let jobId = null, stopped = false, rev;
  const startedAt = Date.now();
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const promise = (async () => {
    let created;
    try { created = await EngineApi.createNote(opts.campaign, opts.kind, opts.brief, opts.hints, opts.tone); } catch (e) { throw new Error(EngineHelpers.errorText(e)); }
    jobId = created.job.id;
    for (;;) {
      if (stopped) throw new Error('Cancelled.');
      let r;
      try { r = await EngineApi.get(jobId, rev); } catch (e) { if (e && e.status === 404) throw new Error('That job is gone.'); await sleep(EngineHelpers.POLL_MS); continue; }
      if (!r.unchanged) {
        rev = r.job.rev;
        const waited = EngineHelpers.elapsedText(startedAt, Date.now());
        if (opts.onStatus) opts.onStatus(`${EngineHelpers.stateText(r.job)}${waited ? ' · ' + waited : ''}`);
        if (!EngineHelpers.isActive(r.job)) {
          const item = r.items && r.items[0];
          if (r.job.state === 'done' && item && item.state === 'done') return { title: item.title, frontmatter: item.frontmatter, body: item.body };
          if (r.job.state === 'cancelled') throw new Error('Cancelled.');
          throw new Error((item && item.error) || r.job.error || 'The engine could not write this one. Try again, or write it by hand.');
        }
      }
      await sleep(EngineHelpers.POLL_MS);
    }
  })();
  return {
    promise,
    cancel() { stopped = true; if (jobId) EngineApi.cancel(jobId).catch(() => {}); },
  };
}

// ---- the campaign's panel -----------------------------------------------------------------------------------------

async function renderJobsPanel(container, campaign, schemas) {
  let status = null;
  try { status = await EngineApi.status(); } catch (e) { return; }           // signed out or unreachable: nothing to show
  if (!status.enabled) {
    container.appendChild(jobEl('p', 'status-text', 'Pack generation (a themed set of linked notes, written in the background) appears here once the engine is switched on.'));
    return;
  }

  const wrap = jobEl('section', 'engine-panel');
  const head = jobEl('div', 'engine-head');
  head.appendChild(jobEl('h3', null, 'Generate a pack'));
  const pill = jobEl('span', 'engine-pill');
  head.appendChild(pill);
  wrap.appendChild(head);
  wrap.appendChild(jobEl('p', 'status-text', 'A pack is a themed set of linked notes. The local model writes them in the background (a few minutes each), so you can leave this page and come back. Nothing is saved until you choose.'));

  // the form
  const form = jobEl('form', 'engine-form');
  const premise = jobEl('textarea'); premise.rows = 3; premise.maxLength = 1500; premise.placeholder = 'A drowned trading city ruled by three rival guilds…'; premise.setAttribute('aria-label', 'Premise');
  const tone = jobEl('input'); tone.maxLength = 200; tone.placeholder = 'Tone (optional): gritty, eerie, coastal…'; tone.setAttribute('aria-label', 'Tone'); tone.autocomplete = 'off';
  const size = jobEl('select'); size.setAttribute('aria-label', 'Size');
  for (const [v, t] of PACK_SIZES) { const o = jobEl('option', null, t); o.value = v; size.appendChild(o); }
  const kinds = jobEl('div', 'engine-kinds');
  const boxes = {};
  for (const k of PACK_KINDS) {
    if (!schemas || !schemas[k]) continue;
    const l = jobEl('label', 'engine-kind');
    const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = true;
    boxes[k] = cb;
    l.appendChild(cb); l.appendChild(document.createTextNode(' ' + (KIND_LABELS[k] || k)));
    kinds.appendChild(l);
  }
  const go = jobEl('button', null, 'Generate pack'); go.type = 'submit';
  const msg = jobEl('span', 'status-text');
  const row = jobEl('div', 'nn-actions'); row.appendChild(size); row.appendChild(go); row.appendChild(msg);
  form.appendChild(premise); form.appendChild(tone); form.appendChild(kinds); form.appendChild(row);
  wrap.appendChild(form);

  const listEl = jobEl('div', 'engine-jobs');
  wrap.appendChild(listEl);
  container.appendChild(wrap);

  const saved = savedSet();
  const cards = new Map();           // job id -> {el, ...parts, rev, drafts: Map(idx -> state)}
  let timer = null;
  let stickyUntil = 0;
  const say = (text) => { msg.textContent = text; stickyUntil = Date.now() + 6000; };

  function setPill(s) {
    const u = EngineHelpers.engineUsable(s);
    pill.textContent = u.use ? 'Engine online' : 'Engine offline';
    pill.className = 'engine-pill ' + (u.use ? 'is-on' : 'is-off');
    go.disabled = !u.use;
    go.title = u.use ? '' : 'The engine is not running, so nothing could write the notes yet.';
    // A message the form just set (Queued, a refusal) stays for a few seconds before this line takes over again.
    if (Date.now() < stickyUntil) return;
    msg.textContent = u.use ? (s.notes ? `${s.notes.left} notes left today` : '') : 'The engine is offline; start it on the server (engine/README.md).';
  }
  setPill(status);

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    if (!premise.value.trim()) { say('Write a premise first.'); return; }
    const chosen = PACK_KINDS.filter((k) => boxes[k] && boxes[k].checked);
    if (!chosen.length) { say('Choose at least one kind of note.'); return; }
    go.disabled = true;
    say('Queuing…');
    try {
      const existing = await collectCampaignTitles(campaign);
      await EngineApi.createPack(campaign, premise.value.trim(), tone.value.trim(), size.value, chosen, existing);
      premise.value = '';
      say('Queued. It will start as soon as the engine is free.');
      await refresh();
    } catch (e) { say(EngineHelpers.errorText(e)); }
    go.disabled = false;
  });

  // ---- a job card -----------------------------------------------------------------------------------------------------
  function buildCard(job) {
    const el = jobEl('article', 'engine-job');
    const top = jobEl('div', 'engine-job-top');
    const title = jobEl('strong', 'engine-job-title');
    const stateEl = jobEl('span', 'status-text');
    const bar = jobEl('div', 'engine-bar'); const fill = jobEl('div', 'engine-bar-fill'); bar.appendChild(fill);
    const actions = jobEl('div', 'engine-job-actions');
    const cancel = jobEl('button', null, 'Cancel'); cancel.type = 'button';
    const del = jobEl('button', null, 'Delete job'); del.type = 'button';
    actions.appendChild(cancel); actions.appendChild(del);
    top.appendChild(title); top.appendChild(stateEl);
    el.appendChild(top); el.appendChild(bar);
    const bible = jobEl('details', 'engine-bible'); bible.hidden = true;
    bible.appendChild(jobEl('summary', null, 'The world it is building from')); const bibleText = jobEl('p', 'status-text'); bible.appendChild(bibleText);
    el.appendChild(bible);
    const drafts = jobEl('div', 'engine-drafts');
    el.appendChild(drafts);
    const saveRow = jobEl('div', 'nn-actions'); saveRow.hidden = true;
    const saveBtn = jobEl('button', null, 'Save selected'); saveBtn.type = 'button';
    const saveMsg = jobEl('span', 'status-text');
    saveRow.appendChild(saveBtn); saveRow.appendChild(saveMsg);
    el.appendChild(saveRow);
    el.appendChild(actions);
    const card = { el, title, stateEl, fill, cancel, del, bible, bibleText, drafts, saveRow, saveBtn, saveMsg, rev: undefined, rows: new Map(), id: job.id };

    cancel.addEventListener('click', async () => { cancel.disabled = true; try { await EngineApi.cancel(job.id); } catch (e) { cancel.disabled = false; stateEl.textContent = EngineHelpers.errorText(e); return; } await refresh(); });
    del.addEventListener('click', async () => {
      if (!del.dataset.armed) { del.dataset.armed = '1'; del.textContent = 'Click again to delete'; setTimeout(() => { delete del.dataset.armed; del.textContent = 'Delete job'; }, 4000); return; }
      try { await EngineApi.remove(job.id); } catch (e) { stateEl.textContent = EngineHelpers.errorText(e); return; }
      el.remove(); cards.delete(job.id);
    });
    saveBtn.addEventListener('click', () => saveSelected(card));
    return card;
  }

  function updateHeader(card, job) {
    if (!card.titleSet) card.title.textContent = job.type === 'pack' ? 'Pack' : 'Note';
    const waited = EngineHelpers.isActive(job) ? EngineHelpers.elapsedText(job.startedAt || job.createdAt, Date.now()) : '';
    card.stateEl.textContent = EngineHelpers.stateText(job) + (waited ? ' · ' + waited : '');
    card.fill.style.width = Math.round(EngineHelpers.fraction(job) * 100) + '%';
    card.cancel.hidden = !EngineHelpers.isActive(job) || !!job.cancelling;
    card.del.hidden = EngineHelpers.isActive(job);
    card.el.classList.toggle('is-active', EngineHelpers.isActive(job));
  }

  function draftRow(card, job, item) {
    const key = `${job.id}:${item.idx}`;
    let row = card.rows.get(item.idx);
    if (!row) {
      const el = jobEl('div', 'engine-draft');
      const top = jobEl('label', 'engine-draft-top');
      const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = false;
      const name = jobEl('strong', null, ''); const kind = jobEl('span', 'engine-pill', item.kind);
      const state = jobEl('span', 'status-text');
      top.appendChild(cb); top.appendChild(name); top.appendChild(kind); top.appendChild(state);
      const details = jobEl('details', 'engine-draft-body');
      details.appendChild(jobEl('summary', null, 'Review and edit'));
      const folder = jobEl('input'); folder.autocomplete = 'off'; folder.setAttribute('aria-label', 'Folder');
      const body = jobEl('textarea'); body.rows = 12; body.setAttribute('aria-label', 'Note text');
      details.appendChild(folder); details.appendChild(body);
      el.appendChild(top); el.appendChild(details);
      card.drafts.appendChild(el);
      row = { el, cb, name, state, details, folder, body, key, filled: false, fm: null, kindName: item.kind };
      card.rows.set(item.idx, row);
    }
    row.name.textContent = item.title || '(untitled)';
    if (item.state === 'done' && !row.filled) {
      row.filled = true;
      row.cb.checked = !saved.has(row.key);
      row.fm = item.frontmatter || {};
      row.folder.value = EngineHelpers.folderFor(schemas && schemas[item.kind], row.fm);
      row.body.value = item.body;
    }
    row.cb.disabled = item.state !== 'done' || saved.has(row.key);
    row.state.textContent = saved.has(row.key) ? 'Saved' : item.state === 'done' ? '' : item.state === 'writing' ? 'Writing…' : item.state === 'failed' ? (item.error || 'Could not be written') : 'Waiting';
    row.el.classList.toggle('is-failed', item.state === 'failed');
    return row;
  }

  async function saveSelected(card) {
    const picked = [...card.rows.values()].filter((r) => r.filled && r.cb.checked && !saved.has(r.key));
    if (!picked.length) { card.saveMsg.textContent = 'Nothing selected.'; return; }
    card.saveBtn.disabled = true;
    let ok = 0, failed = 0;
    for (const r of picked) {
      card.saveMsg.textContent = `Saving ${ok + failed + 1} of ${picked.length}…`;
      const title = r.name.textContent;
      const folder = r.folder.value.trim() || 'Misc';
      let done = false;
      for (let n = 1; n <= 4 && !done; n++) {
        try {
          const schema = schemas && schemas[r.kindName];
          const fm = { ...(r.fm || {}), tags: [schema ? schema.tag : ''] };
          await Api.post('/note', { campaign, path: EngineHelpers.pathFor(folder, title, n), frontmatter: fm, body: r.body.value });
          done = true;
        } catch (e) {
          if (!(e.data && e.data.error === 'file_exists')) { r.state.textContent = e.code === 'unauthenticated' ? 'Log in to save' : (e.data && e.data.error === 'daily_cap_reached') ? "Today's save limit is reached" : 'Could not save'; break; }
        }
      }
      if (done) { ok++; saved.add(r.key); r.cb.checked = false; r.cb.disabled = true; r.state.textContent = 'Saved'; } else failed++;
    }
    rememberSaved(saved);
    card.saveBtn.disabled = false;
    card.saveMsg.textContent = `${ok} saved${failed ? `, ${failed} could not be saved` : ''}.`;
  }

  async function fillCard(card, job) {
    let r;
    try { r = await EngineApi.get(job.id, card.rev); } catch (e) { return; }
    if (r.unchanged) return;
    card.rev = r.job.rev;
    const spec = r.job.spec || {};
    card.title.textContent = (r.job.type === 'pack' ? `Pack: ${spec.premise || ''}` : `${KIND_LABELS[spec.kind] || spec.kind || 'Note'}: ${spec.brief || ''}`).replace(/\s+/g, ' ').slice(0, 110);
    card.titleSet = true;
    updateHeader(card, r.job);
    if (r.job.bible) { card.bible.hidden = false; card.bibleText.textContent = r.job.bible; }
    for (const item of r.items) draftRow(card, r.job, item);
    card.saveRow.hidden = ![...card.rows.values()].some((x) => x.filled);
  }

  async function refresh() {
    if (!document.body.contains(wrap)) { clearTimeout(timer); return; }       // the person has moved on
    let jobs, s;
    try { [jobs, s] = await Promise.all([EngineApi.list(campaign), EngineApi.status()]); } catch (e) { schedule(); return; }
    setPill(s);
    for (const job of jobs.jobs) {
      let card = cards.get(job.id);
      if (!card) { card = buildCard(job); cards.set(job.id, card); }
      card.job = job;
      updateHeader(card, job);
    }
    // newest first
    jobs.jobs.slice().reverse().forEach((j) => listEl.insertBefore(cards.get(j.id).el, listEl.firstChild));
    for (const [id, card] of cards) if (!jobs.jobs.some((j) => j.id === id)) { card.el.remove(); cards.delete(id); }
    for (const job of jobs.jobs) { const card = cards.get(job.id); if (EngineHelpers.isActive(job) || card.rev === undefined) await fillCard(card, job); else if (card.rev !== job.rev) await fillCard(card, job); }
    schedule();
  }

  function schedule() {
    clearTimeout(timer);
    if (!document.body.contains(wrap)) return;
    const active = [...cards.values()].some((c) => c.job && EngineHelpers.isActive(c.job));
    timer = setTimeout(refresh, active ? EngineHelpers.POLL_MS : EngineHelpers.POLL_MS * 5);
  }

  await refresh();
}
