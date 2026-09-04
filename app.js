const routes = {
  '': renderLibrary,
  'campaign': renderCampaign,
  'new-note': renderNewNote,
  'map/dungeon': renderDungeonMap,
  'map/overworld': renderOverworldMap,
  'map/settlement': renderSettlementMap,
};

function parseHash() {
  const hash = location.hash.replace(/^#\/?/, '');
  const [route, queryStr] = hash.split('?');
  const params = new URLSearchParams(queryStr || '');
  return { route, params };
}

function render() {
  const { route, params } = parseHash();
  const fn = routes[route] || renderLibrary;
  const app = document.getElementById('app');
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
