async function renderNewNote(container, params) {
  const campaign = params.get('campaign');
  const kind = params.get('kind') || 'Location';
  if (!campaign) { location.hash = '#/'; return; }

  container.innerHTML = `
    <p><a href="#/campaign?name=${encodeURIComponent(campaign)}">&larr; ${escapeHtml(campaign)}</a></p>
    <h2>New ${escapeHtml(KIND_LABELS[kind] || kind)}</h2>
    <form id="new-note-form">
      <label>Title
        <input id="nn-title" required autocomplete="off">
      </label>
      <label>Folder path (within campaign)
        <input id="nn-folder" autocomplete="off">
      </label>
      <div id="nn-fields"></div>
      <label>Brief (what should this be about?)
        <textarea id="nn-brief" rows="3"></textarea>
      </label>
      <label>Tone (optional &mdash; blank = neutral fantasy)
        <input id="nn-tone" placeholder="e.g. gritty low-magic, eerie coastal..." autocomplete="off">
      </label>
      <div class="nn-actions">
        <button type="button" id="nn-generate">Generate draft with Ollama</button>
        <span id="nn-generate-status" class="status-text"></span>
      </div>
      <label>Body
        <textarea id="nn-body" rows="14"></textarea>
      </label>
      <div class="nn-actions">
        <button type="submit">Save</button>
        <button type="button" id="nn-download">Download .md</button>
        <span id="nn-save-status" class="status-text"></span>
      </div>
    </form>
  `;

  let schema = {};
  try {
    const allSchemas = await Api.get('/schema');
    schema = allSchemas[kind] || {};
  } catch (e) { /* fall back to empty schema */ }

  const fieldsEl = container.querySelector('#nn-fields');
  const fieldInputs = {};
  for (const f of (schema.fields || [])) {
    const label = document.createElement('label');
    label.textContent = f.replace(/_/g, ' ');
    const input = document.createElement('input');
    input.autocomplete = 'off';
    label.appendChild(input);
    fieldsEl.appendChild(label);
    fieldInputs[f] = input;
  }

  const folderInput = container.querySelector('#nn-folder');
  if (schema.folderTemplate) {
    folderInput.placeholder = schema.folderTemplate;
  }

  container.querySelector('#nn-generate').addEventListener('click', async () => {
    const statusEl = container.querySelector('#nn-generate-status');
    const brief = container.querySelector('#nn-brief').value.trim();
    if (!brief) { statusEl.textContent = 'Write a brief first.'; return; }
    statusEl.textContent = 'Generating on the self-hosted model… this can take 30–90s or longer (CPU inference, not a hosted API).';

    const hints = {};
    for (const f in fieldInputs) { if (fieldInputs[f].value) hints[f] = fieldInputs[f].value; }
    const tone = container.querySelector('#nn-tone').value.trim();

    try {
      const draft = await Api.post('/generate-draft', { campaign, kind, brief, hints, tone });
      if (draft.parsed) {
        for (const f in fieldInputs) {
          if (draft.frontmatter[f] !== undefined && draft.frontmatter[f] !== null) {
            fieldInputs[f].value = Array.isArray(draft.frontmatter[f]) ? draft.frontmatter[f].join(', ') : draft.frontmatter[f];
          }
        }
        container.querySelector('#nn-body').value = draft.body.trim();
        statusEl.textContent = 'Draft ready — review before saving.';
      } else {
        container.querySelector('#nn-body').value = draft.raw;
        statusEl.textContent = 'Could not parse frontmatter — edit the raw output below.';
      }
    } catch (e) {
      if (e.data && e.data.error === 'daily_cap_reached') {
        statusEl.textContent = 'Daily generation cap reached. Try again tomorrow.';
      } else if (e.data && e.data.error === 'ollama_unreachable') {
        statusEl.textContent = 'Could not reach the self-hosted model right now. You can still write the note by hand.';
      } else {
        statusEl.textContent = 'Generation failed. You can still write the note by hand.';
      }
    }
  });

  container.querySelector('#nn-download').addEventListener('click', () => {
    const title = container.querySelector('#nn-title').value.trim() || 'untitled';
    const frontmatter = { tags: [schema.tag || ''] };
    for (const f in fieldInputs) { frontmatter[f] = fieldInputs[f].value; }
    downloadNoteAsMarkdown(title, frontmatter, container.querySelector('#nn-body').value);
  });

  container.querySelector('#new-note-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const statusEl = container.querySelector('#nn-save-status');
    const title = container.querySelector('#nn-title').value.trim();
    if (!title) return;

    let folder = folderInput.value.trim();
    if (!folder) folder = (schema.folderTemplate || 'Misc').replace(/\{[^}]+\}/g, 'Misc');
    const filename = title.replace(/[\\/:*?"<>|]/g, '').trim() + '.md';
    const relPath = `${folder}/${filename}`;

    const frontmatter = { tags: [schema.tag || ''] };
    for (const f in fieldInputs) { frontmatter[f] = fieldInputs[f].value; }
    const body = container.querySelector('#nn-body').value;

    try {
      await Api.post('/note', { campaign, path: relPath, frontmatter, body });
      location.hash = `#/campaign?name=${encodeURIComponent(campaign)}`;
    } catch (e) {
      statusEl.textContent = (e.data && e.data.error === 'file_exists')
        ? 'A note already exists at that path — change the title or folder.'
        : 'Could not save note.';
    }
  });
}
