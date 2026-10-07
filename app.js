const routes = {
  '': renderLibrary,
  'campaign': renderCampaign,
  'new-note': renderNewNote,
  'map/dungeon': renderDungeonMap,
  'map/overworld': renderOverworldMap,
  'map/settlement': renderSettlementMap,
  'map/detail': renderDetailMap,
  'map/landmark': renderLandmarkMap,
};

function parseHash() {
  const hash = location.hash.replace(/^#\/?/, '');
  const [route, queryStr] = hash.split('?');
  const params = new URLSearchParams(queryStr || '');
  return { route, params };
}

// Which of the three section tabs a route belongs under. The note and campaign
// views live under Library; the settlement, detail and landmark generators
// are reached from the overworld map.
function navTabFor(route) {
  if (route === 'map/dungeon') return '#/map/dungeon';
  if (route === 'map/overworld' || route === 'map/settlement' || route === 'map/detail' || route === 'map/landmark') return '#/map/overworld';
  return '#/';
}

function markActiveTab(route) {
  const active = navTabFor(route);
  document.querySelectorAll('.app-nav a').forEach((a) => {
    if (a.getAttribute('href') === active) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
}

function render() {
  const { route, params } = parseHash();
  const fn = routes[route] || renderLibrary;
  const app = document.getElementById('app');
  markActiveTab(route);
  // Note-viewer modals are appended to document.body (so they can overlay
  // everything), not #app -- clear them on every navigation so leaving a
  // modal open and following a link/back-button doesn't strand a full-screen
  // overlay over the next view.
  document.querySelectorAll('.note-modal').forEach((m) => m.remove());
  app.innerHTML = '';
  fn(app, params);
}

window.addEventListener('hashchange', render);
window.addEventListener('DOMContentLoaded', render);
