// Linking maps and notes.
//
// A saved map used to be only a picture (Images/<name>.png): nothing said how it was made, so it
// could not be opened again, and a note could only reach it if you pasted the image's wikilink by
// hand. Now saving a map also writes a small **map note** (Maps/<name>.md) beside the picture:
//
//   ---
//   tags: [M]
//   Map_Type: settlement          what it is
//   Map_Route: map/settlement     which generator makes it
//   Map_Params: seed=123&idx=0&name=Saltgate&tier=town      exactly how (the same URL parameters the page uses)
//   Image: Saltgate.png           the saved picture
//   Location: Saltgate            the note it belongs to, if it was drawn from one
//   ---
//   # Saltgate
//   ![[Saltgate.png]]
//   Location: [[Saltgate]]
//
// It is an ordinary note, so it shows in the library, can be linked from any note with [[Saltgate]],
// and shows its picture. A note whose frontmatter carries Map_Route + Map_Params gets an "Open map"
// button that regenerates the very same map; a Location note gets "Draw a settlement map", which
// opens the settlement generator seeded from the note's title and remembers which note it was for.
//
// Pure helpers only (require()-able from Node for test/map-link.test.js); the pages call them.

const MapLink = (function () {
  // The generators whose whole state is in the URL, so a saved link can reproduce the map exactly.
  const ROUTES = ['map/settlement', 'map/detail', 'map/landmark'];
  const TYPE_OF = { 'map/settlement': 'settlement', 'map/detail': 'detail', 'map/landmark': 'landmark', 'map/overworld': 'overworld', 'map/dungeon': 'dungeon' };
  const MAX_PARAMS = 5000;                       // the terrain grid a settlement threads through is about 4,400 characters
  const SAFE_PARAMS = /^[A-Za-z0-9%_.~+=&,-]*$/;  // what a URL query string made by URLSearchParams contains
  const TIERS = ['village', 'town', 'city'];

  // A name that is safe as a note or file name: no slashes, no characters Windows or Obsidian dislike.
  function safeName(s, fallback) {
    const t = String(s === undefined || s === null ? '' : s).replace(/[\\/:*?"<>|#^\[\]\u0000-\u001f]/g, ' ').replace(/\.{2,}/g, ' ').replace(/\s+/g, ' ').trim().replace(/^\.+/, '');
    return (t || fallback || '').slice(0, 80);
  }

  // A steady positive integer from a name (FNV-1a), so the same Location always draws the same town.
  function seedFromTitle(title) {
    let h = 0x811c9dc5;
    const s = String(title || '');
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return (h % 2147483646) + 1;
  }

  // The URL parameters for a standalone settlement drawn from a note. `campaign` and `location`
  // are remembered so the Save step can file the map and link it back.
  function settlementParams(title, tier, campaign) {
    const p = new URLSearchParams();
    p.set('seed', String(seedFromTitle(title)));
    p.set('idx', '0');
    p.set('name', String(title || 'Unnamed settlement').slice(0, 80));
    p.set('tier', TIERS.indexOf(tier) >= 0 ? tier : 'town');
    if (campaign) p.set('campaign', campaign);
    p.set('location', String(title || '').slice(0, 120));
    return p.toString();
  }

  // The part of a page's parameters that describes the MAP (not where it was filed from).
  function mapParamsOnly(search) {
    const p = new URLSearchParams(typeof search === 'string' ? search : search.toString());
    p.delete('campaign');
    p.delete('location');
    return p.toString();
  }

  // -> {path, frontmatter, body} for the map note, or null when there is nothing to write.
  // info: {route, params (string or URLSearchParams), title, image, location}
  function buildMapNote(info) {
    if (!info || !info.image) return null;
    const title = safeName(info.title, 'Map');
    const type = TYPE_OF[info.route] || '';
    const fm = { tags: ['M'], Map_Type: type, Map_Route: '', Map_Params: '', Image: info.image, Location: safeName(info.location, '') };
    if (ROUTES.indexOf(info.route) >= 0 && info.params !== undefined) {
      const q = mapParamsOnly(info.params);
      if (q && q.length <= MAX_PARAMS && SAFE_PARAMS.test(q)) { fm.Map_Route = info.route; fm.Map_Params = q; }
    }
    const lines = [`# ${title}`, '', `![[${info.image}]]`, ''];
    if (fm.Location) lines.push(`Location: [[${fm.Location}]]`, '');
    lines.push(fm.Map_Route ? 'Use **Open map** to draw this map again exactly as saved.' : 'The picture is saved above; this kind of map cannot be reopened from here.');
    return { title, frontmatter: fm, body: lines.join('\n') };
  }

  // The path a map note is saved at; `n` > 1 numbers a name that is already taken.
  function notePath(title, n) {
    const base = safeName(title, 'Map');
    return `Maps/${n > 1 ? `${base} (${n})` : base}.md`;
  }

  // The page address a map note reopens, or null when its frontmatter is missing, from an
  // unknown generator, or carries anything that is not a plain query string.
  function mapHash(frontmatter) {
    if (!frontmatter || typeof frontmatter !== 'object') return null;
    const route = typeof frontmatter.Map_Route === 'string' ? frontmatter.Map_Route.trim() : '';
    const params = typeof frontmatter.Map_Params === 'string' ? frontmatter.Map_Params.trim() : '';
    if (ROUTES.indexOf(route) < 0 || !params || params.length > MAX_PARAMS || !SAFE_PARAMS.test(params)) return null;
    return `#/${route}?${params}`;
  }

  // Is this a Location note (the kind that can have a settlement drawn for it)?
  function isLocation(frontmatter) {
    const tags = frontmatter && frontmatter.tags;
    return Array.isArray(tags) ? tags.indexOf('A') >= 0 : tags === 'A';
  }

  // The page address that draws a settlement for a Location note.
  function settlementHash(title, tier, campaign) { return `#/map/settlement?${settlementParams(title, tier, campaign)}`; }

  return { ROUTES, TIERS, safeName, seedFromTitle, settlementParams, mapParamsOnly, buildMapNote, notePath, mapHash, isLocation, settlementHash };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = MapLink;
