async function renderLibrary(container) {
  container.innerHTML = `
    <h2>Campaign Library</h2>
    <div id="lib-list">Loading&hellip;</div>
    <form id="new-campaign-form" class="inline-form">
      <input id="new-campaign-name" placeholder="New campaign name" required autocomplete="off">
      <button type="submit">Create campaign</button>
      <span id="new-campaign-status" class="status-text"></span>
    </form>
  `;

  const listEl = container.querySelector('#lib-list');
  try {
    const data = await Api.get('/campaigns');
    if (!data.campaigns.length) {
      listEl.innerHTML = '<p class="empty-note">No campaigns yet &mdash; create one below.</p>';
    } else {
      const ul = document.createElement('ul');
      ul.className = 'campaign-list';
      for (const c of data.campaigns) {
        const li = document.createElement('li');
        const a = document.createElement('a');
        a.href = `#/campaign?name=${encodeURIComponent(c.name)}`;
        a.textContent = c.name;
        const meta = document.createElement('span');
        meta.className = 'campaign-meta';
        meta.textContent = `${c.noteCount} note${c.noteCount === 1 ? '' : 's'}`;
        li.appendChild(a);
        li.appendChild(meta);
        ul.appendChild(li);
      }
      listEl.innerHTML = '';
      listEl.appendChild(ul);
    }
  } catch (e) {
    listEl.innerHTML = `<p class="error">Couldn't load campaigns: ${escapeHtml(e.message)}</p>`;
  }

  container.querySelector('#new-campaign-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const nameInput = container.querySelector('#new-campaign-name');
    const statusEl = container.querySelector('#new-campaign-status');
    const name = nameInput.value.trim();
    if (!name) return;
    statusEl.textContent = '';
    try {
      await Api.post('/campaigns', { name });
      location.hash = `#/campaign?name=${encodeURIComponent(name)}`;
    } catch (e) {
      // Inline status text, not alert() -- matches every other gated action
      // in this codebase (new-note.js's Save/Generate, map-dungeon.js's
      // Save to campaign), none of which block the page with a native
      // dialog (2026-09-03 fix).
      if (e.code === 'unauthenticated') {
        statusEl.textContent = 'You need to be logged in to create a campaign. Log in (top of page) and try again.';
      } else if (e.code === 'forbidden') {
        statusEl.textContent = "You're logged in, but don't have access to create campaigns.";
      } else {
        statusEl.textContent = (e.data && e.data.error === 'campaign_exists') ? 'A campaign with that name already exists.' : 'Could not create campaign.';
      }
    }
  });
}
