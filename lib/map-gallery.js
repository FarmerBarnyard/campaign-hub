// The map gallery's pure parts: turning a campaign's saved map notes into cards, and filtering them.
//
// Saving a map writes a map note, Maps/<name>.md (lib/map-link.js), with frontmatter
//   tags: [M]   Map_Type   Map_Route   Map_Params   Image   Location
// beside the picture (Images/<name>.png). The gallery lists those notes for one campaign, shows each picture, and
// links to the note and (when the map can be drawn again) to "Open map". Nothing here touches the network or the
// page, so Node can test it (test/map-gallery.test.js); views/map-gallery.js draws the page.

const MapGallery = (function () {
  // The kinds a saved map can be, in the order the filter shows them.
  const TYPES = [
    { id: 'settlement', label: 'Settlement' },
    { id: 'detail', label: 'Detail / zoom' },
    { id: 'landmark', label: 'Landmark' },
    { id: 'dungeon', label: 'Dungeon' },
    { id: 'overworld', label: 'Overworld' },
  ];
  const MAX_CARDS = 60;   // a gallery shows this many at once; each card costs one request for its note

  function typeLabel(type) {
    for (const t of TYPES) if (t.id === type) return t.label;
    return 'Other';
  }

  // The names of the map notes in a Maps/ listing ({dirs, files:[{name}]}).
  function mapNoteNames(listing) {
    const files = listing && Array.isArray(listing.files) ? listing.files : [];
    return files.map((f) => f && f.name).filter((n) => typeof n === 'string' && /\.md$/i.test(n)).sort((a, b) => a.localeCompare(b));
  }

  // Is this note a map note (the frontmatter MapLink writes)?
  function isMapNote(fm) {
    if (!fm || typeof fm !== 'object') return false;
    const tags = fm.tags;
    const tagged = Array.isArray(tags) ? tags.indexOf('M') >= 0 : tags === 'M';
    return tagged || (typeof fm.Map_Type === 'string' && fm.Map_Type !== '');
  }

  // One card from a map note. `reopenHash` is MapLink.mapHash(frontmatter), passed in so this file stands alone.
  function cardFrom(campaign, relPath, note, reopenHash) {
    const fm = (note && note.frontmatter) || {};
    const file = String(relPath || '').split('/').pop().replace(/\.md$/i, '');
    const type = typeof fm.Map_Type === 'string' && fm.Map_Type ? fm.Map_Type : 'other';
    return {
      campaign, path: relPath, title: file || 'Map', type, typeLabel: typeLabel(type),
      image: typeof fm.Image === 'string' ? fm.Image.replace(/^.*[\\/]/, '') : '',
      location: typeof fm.Location === 'string' ? fm.Location : '',
      reopen: reopenHash || null,
    };
  }

  // type: 'all' or a type id; text: a word or two to find in the title or the location.
  function filterCards(cards, filter) {
    const f = filter || {};
    const text = String(f.text || '').trim().toLowerCase();
    return (cards || []).filter((c) => {
      if (f.type && f.type !== 'all' && c.type !== f.type) return false;
      if (text && c.title.toLowerCase().indexOf(text) === -1 && c.location.toLowerCase().indexOf(text) === -1) return false;
      return true;
    });
  }

  // How many cards of each kind, for the filter buttons: { all, settlement, ..., other }.
  function countsByType(cards) {
    const out = { all: (cards || []).length };
    for (const c of cards || []) out[c.type] = (out[c.type] || 0) + 1;
    return out;
  }

  // The line under the gallery heading.
  function summaryText(total, shown, capped) {
    if (!total) return 'No saved maps in this campaign yet.';
    const base = total + (total === 1 ? ' map' : ' maps');
    if (capped) return `${base} saved; showing the first ${MAX_CARDS}. Narrow it with the filters.`;
    return shown === total ? base + '.' : `${shown} of ${base}.`;
  }

  return { TYPES, MAX_CARDS, typeLabel, mapNoteNames, isMapNote, cardFrom, filterCards, countsByType, summaryText };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = MapGallery;
