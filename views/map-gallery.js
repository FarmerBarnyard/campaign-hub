// The map gallery page (#/maps): every map saved to a campaign, as pictures. Pure parts are in lib/map-gallery.js.
//
// For the chosen campaign it lists Maps/ (the map notes lib/map-link.js writes), reads each note's frontmatter, and
// shows the picture it points at. Pictures load the way notes' embedded images do (the login cookie and an Origin
// header, so crossOrigin is 'use-credentials'). Nothing from the server goes into innerHTML: titles, names and
// locations are set with textContent, and the only links are page addresses MapLink.mapHash has already vetted.

async function renderMapGallery(container, params) {
  container.innerHTML = `
    <h2>Map gallery</h2>
    <div class="gallery-controls">
      <label>Campaign <select id="gal-campaign"></select></label>
      <label>Find <input id="gal-text" type="search" placeholder="Name or place" autocomplete="off"></label>
      <div class="gallery-types" id="gal-types" role="group" aria-label="Kind of map"></div>
    </div>
    <p class="status-text" id="gal-summary" role="status"></p>
    <div class="gallery-grid" id="gal-grid"></div>
  `;
  const select = container.querySelector('#gal-campaign');
  const textInput = container.querySelector('#gal-text');
  const typesEl = container.querySelector('#gal-types');
  const summaryEl = container.querySelector('#gal-summary');
  const grid = container.querySelector('#gal-grid');

  let campaigns = [];
  try {
    campaigns = (await Api.get('/campaigns')).campaigns.map((c) => c.name);
  } catch (e) {
    summaryEl.textContent = e.code === 'unauthenticated' ? 'Log in (top of page) to see your maps.' : "Couldn't load your campaigns.";
    return;
  }
  if (!campaigns.length) { summaryEl.textContent = 'No campaigns yet. Create one in the Library, then save a map to it.'; return; }
  for (const name of campaigns) {
    const o = document.createElement('option');
    o.value = name; o.textContent = name;
    select.appendChild(o);
  }
  const wanted = params.get('campaign');
  select.value = wanted && campaigns.indexOf(wanted) >= 0 ? wanted : campaigns[0];

  let cards = [];
  let capped = false;
  let total = 0;
  let filter = { type: 'all', text: '' };
  let loadId = 0;

  function drawTypes() {
    typesEl.textContent = '';
    const counts = MapGallery.countsByType(cards);
    const kinds = [{ id: 'all', label: 'All' }].concat(MapGallery.TYPES).concat(counts.other ? [{ id: 'other', label: 'Other' }] : []);
    for (const k of kinds) {
      if (k.id !== 'all' && !counts[k.id]) continue;
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = `${k.label} (${counts[k.id] || 0})`;
      b.setAttribute('aria-pressed', String(filter.type === k.id));
      b.addEventListener('click', () => { filter.type = k.id; drawTypes(); drawCards(); });
      typesEl.appendChild(b);
    }
  }

  function drawCards() {
    const shown = MapGallery.filterCards(cards, filter);
    summaryEl.textContent = MapGallery.summaryText(total, shown.length, capped);
    grid.textContent = '';
    if (!shown.length && cards.length) { const p = document.createElement('p'); p.className = 'empty-note'; p.textContent = 'Nothing matches that filter.'; grid.appendChild(p); return; }
    for (const c of shown) grid.appendChild(cardEl(c));
  }

  function cardEl(c) {
    const card = document.createElement('article');
    card.className = 'gallery-card';
    const pic = document.createElement('div');
    pic.className = 'gallery-pic';
    if (c.image) {
      const img = document.createElement('img');
      img.alt = c.title;
      img.loading = 'lazy';
      img.crossOrigin = 'use-credentials';   // the cookie and an Origin header; must be set before src
      img.src = `${API_BASE}/image?campaign=${encodeURIComponent(c.campaign)}&name=${encodeURIComponent(c.image)}`;
      img.addEventListener('error', () => { pic.textContent = 'Picture not found'; pic.classList.add('missing'); });
      pic.appendChild(img);
    } else {
      pic.textContent = 'No picture saved';
      pic.classList.add('missing');
    }
    card.appendChild(pic);
    const body = document.createElement('div');
    body.className = 'gallery-body';
    const title = document.createElement('h3');
    title.textContent = c.title;
    body.appendChild(title);
    const meta = document.createElement('p');
    meta.className = 'campaign-meta';
    meta.textContent = c.typeLabel + (c.location ? ' · ' + c.location : '');
    body.appendChild(meta);
    const acts = document.createElement('div');
    acts.className = 'gallery-actions';
    if (c.reopen) {
      const open = document.createElement('a');
      open.className = 'btn-new-kind';
      open.href = c.reopen;
      open.textContent = 'Open map';
      acts.appendChild(open);
    }
    const note = document.createElement('button');
    note.type = 'button';
    note.textContent = 'Note';
    note.addEventListener('click', () => { if (typeof viewNote === 'function') viewNote(c.campaign, c.path); });
    acts.appendChild(note);
    body.appendChild(acts);
    card.appendChild(body);
    return card;
  }

  async function load() {
    const mine = ++loadId;
    const campaign = select.value;
    cards = []; capped = false; total = 0; filter = { type: 'all', text: textInput.value };
    grid.textContent = '';
    drawTypes();
    summaryEl.textContent = 'Loading maps…';
    let names = [];
    try {
      names = MapGallery.mapNoteNames(await Api.get(`/list?campaign=${encodeURIComponent(campaign)}&path=Maps`));
    } catch (e) {
      // A campaign with no Maps folder yet answers 404: that is just "none saved".
      if (mine !== loadId) return;
      if (e.status && e.status !== 404) { summaryEl.textContent = "Couldn't load this campaign's maps."; return; }
    }
    if (mine !== loadId) return;
    total = names.length;
    capped = names.length > MapGallery.MAX_CARDS;
    const wantedNames = names.slice(0, MapGallery.MAX_CARDS);
    // Four notes at a time: each card is one request, and the page should stay responsive.
    let next = 0;
    async function worker() {
      while (next < wantedNames.length) {
        const name = wantedNames[next++];
        const relPath = `Maps/${name}`;
        try {
          const note = await Api.get(`/note?campaign=${encodeURIComponent(campaign)}&path=${encodeURIComponent(relPath)}`);
          if (mine !== loadId) return;
          if (MapGallery.isMapNote(note.frontmatter)) cards.push(MapGallery.cardFrom(campaign, relPath, note, MapLink.mapHash(note.frontmatter)));
        } catch (e) { /* one unreadable note is skipped, the rest still show */ }
      }
    }
    await Promise.all([worker(), worker(), worker(), worker()]);
    if (mine !== loadId) return;
    cards.sort((a, b) => a.title.localeCompare(b.title));
    if (!capped) total = cards.length;   // a note in Maps/ that is not a map is not counted
    drawTypes();
    drawCards();
  }

  select.addEventListener('change', load);
  textInput.addEventListener('input', () => { filter.text = textInput.value; drawCards(); });
  await load();
}
