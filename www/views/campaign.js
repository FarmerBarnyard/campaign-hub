const KIND_LABELS = {
  Location: 'Location / Area',
  Entity: 'Entity (NPC / Creature)',
  Religion: 'Religion / Faction',
  Quest: 'Quest',
  Item: 'Item',
  Material: 'Material',
  Spell: 'Spell',
  StatusEffect: 'Status Effect',
};

async function renderCampaign(container, params) {
  const campaign = params.get('name');
  if (!campaign) { location.hash = '#/'; return; }

  container.innerHTML = `
    <p><a href="#/">&larr; Library</a></p>
    <h2>${escapeHtml(campaign)}</h2>
    <div class="kind-buttons" id="kind-buttons"></div>
    <div id="campaign-content">Loading&hellip;</div>
  `;

  const kindButtons = container.querySelector('#kind-buttons');
  for (const kind of Object.keys(KIND_LABELS)) {
    const btn = document.createElement('a');
    btn.className = 'btn-new-kind';
    btn.href = `#/new-note?campaign=${encodeURIComponent(campaign)}&kind=${kind}`;
    btn.textContent = `+ ${KIND_LABELS[kind]}`;
    kindButtons.appendChild(btn);
  }

  const contentEl = container.querySelector('#campaign-content');
  await loadCampaignTree(contentEl, campaign);
}

async function loadCampaignTree(container, campaign, relPath = '') {
  container.innerHTML = 'Loading&hellip;';
  try {
    const listing = await Api.get(`/api/list?campaign=${encodeURIComponent(campaign)}&path=${encodeURIComponent(relPath)}`);
    container.innerHTML = '';
    if (!listing.dirs.length && !listing.files.length) {
      container.innerHTML = '<p class="empty-note">Nothing generated here yet.</p>';
      return;
    }
    const ul = document.createElement('ul');
    ul.className = 'tree-list';

    for (const d of listing.dirs) {
      const li = document.createElement('li');
      li.className = 'tree-dir';
      const label = document.createElement('span');
      label.textContent = '\u{1F4C1} ' + d;
      li.appendChild(label);
      const sub = document.createElement('div');
      sub.className = 'tree-sub';
      li.appendChild(sub);
      label.addEventListener('click', async () => {
        if (sub.dataset.loaded) {
          sub.classList.toggle('open');
          return;
        }
        sub.dataset.loaded = '1';
        sub.classList.add('open');
        await loadCampaignTree(sub, campaign, relPath ? `${relPath}/${d}` : d);
      });
      ul.appendChild(li);
    }

    for (const f of listing.files) {
      if (!f.name.endsWith('.md')) continue;
      const li = document.createElement('li');
      li.className = 'tree-file';
      const a = document.createElement('a');
      a.href = '#';
      a.textContent = '\u{1F4C4} ' + f.name.replace(/\.md$/, '');
      a.addEventListener('click', async (ev) => {
        ev.preventDefault();
        await viewNote(campaign, relPath ? `${relPath}/${f.name}` : f.name);
      });
      li.appendChild(a);
      ul.appendChild(li);
    }

    container.appendChild(ul);
  } catch (e) {
    container.innerHTML = `<p class="error">Couldn't load: ${escapeHtml(e.message)}</p>`;
  }
}

async function viewNote(campaign, relPath) {
  const modal = document.createElement('div');
  modal.className = 'note-modal';
  modal.innerHTML = '<div class="note-modal-inner"><button class="note-modal-close">&times;</button><div class="note-modal-body">Loading&hellip;</div></div>';
  document.body.appendChild(modal);
  modal.querySelector('.note-modal-close').addEventListener('click', () => modal.remove());
  modal.addEventListener('click', (ev) => { if (ev.target === modal) modal.remove(); });

  try {
    const note = await Api.get(`/api/note?campaign=${encodeURIComponent(campaign)}&path=${encodeURIComponent(relPath)}`);
    const bodyEl = modal.querySelector('.note-modal-body');
    bodyEl.innerHTML = '';

    const fmTable = document.createElement('table');
    fmTable.className = 'frontmatter-table';
    for (const key of Object.keys(note.frontmatter)) {
      const val = note.frontmatter[key];
      const tr = document.createElement('tr');
      const tdKey = document.createElement('td');
      tdKey.textContent = key;
      const tdVal = document.createElement('td');
      tdVal.textContent = Array.isArray(val) ? val.join(', ') : (val ?? '');
      tr.appendChild(tdKey);
      tr.appendChild(tdVal);
      fmTable.appendChild(tr);
    }
    bodyEl.appendChild(fmTable);

    const bodyDiv = document.createElement('div');
    bodyDiv.className = 'note-body';
    bodyEl.appendChild(bodyDiv);
    renderNoteBody(bodyDiv, campaign, note.body);

    bodyDiv.querySelectorAll('.wikilink').forEach(async (span) => {
      const name = span.dataset.link;
      try {
        const res = await Api.get(`/api/resolve-link?campaign=${encodeURIComponent(campaign)}&text=${encodeURIComponent(name)}`);
        if (res.found) {
          span.classList.add('wikilink-resolved');
          span.addEventListener('click', async () => {
            modal.remove();
            await viewNote(campaign, res.path);
          });
        }
      } catch (e) { /* leave unresolved */ }
    });
  } catch (e) {
    modal.querySelector('.note-modal-body').innerHTML = `<p class="error">Couldn't load note.</p>`;
  }
}
