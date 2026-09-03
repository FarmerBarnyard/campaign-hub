// Shared visual themes for both map generators (map-dungeon.js,
// map-overworld.js). A theme is just a named palette + a couple of style
// flags -- it never changes generation logic (room layout, heightmap,
// settlement placement), only how the same generated data gets drawn, so
// switching themes on an existing seed redraws the identical map in a new
// style rather than regenerating it.
const MAP_THEMES = {
  parchment: {
    label: 'Parchment',
    dungeon: {
      bg: '#e6d7ae',
      rock: '#c9b483',
      room: '#f2e6c2',
      corridor: '#dcc793',
      stroke: 'rgba(59,42,20,0.55)',
      wobble: true,
    },
    overworld: {
      biomes: {
        deepwater: '#5c7d8a',
        shallowwater: '#84a8ad',
        beach: '#d9c48d',
        plains: '#b7a25b',
        forest: '#6d7a44',
        hills: '#a2895a',
        mountains: '#8b7a63',
        snow: '#efe6cf',
      },
      road: 'rgba(74,50,20,0.75)',
      settlement: { village: '#8a5a3a', town: '#6b4226', city: '#4a2c17' },
      ink: 'rgba(59,42,20,0.55)',
      label: '#3b2a14',
    },
  },
  grim: {
    label: 'Dungeon Grim',
    dungeon: {
      bg: '#08080a',
      rock: '#0a0a0c',
      room: '#5a4a38',
      corridor: '#3a3128',
      stroke: 'rgba(0,0,0,0.7)',
      wobble: false,
    },
    overworld: {
      biomes: {
        deepwater: '#0f1f2e',
        shallowwater: '#1c3446',
        beach: '#5a5240',
        plains: '#3c4a2c',
        forest: '#1e2e18',
        hills: '#4a4030',
        mountains: '#2e2b28',
        snow: '#c9cdd2',
      },
      road: 'rgba(160,140,100,0.55)',
      settlement: { village: '#8a2020', town: '#a83030', city: '#c04040' },
      ink: 'rgba(0,0,0,0.65)',
      label: '#d8cdb8',
    },
  },
  modern: {
    label: 'Modern Cartography',
    dungeon: {
      bg: '#14171c',
      rock: '#14171c',
      room: '#eef1f5',
      corridor: '#b9c3cc',
      stroke: 'rgba(20,23,28,0.35)',
      wobble: false,
    },
    overworld: {
      biomes: {
        deepwater: '#1b5c8c',
        shallowwater: '#4a90c4',
        beach: '#e8dcae',
        plains: '#8fc46a',
        forest: '#3f7d3a',
        hills: '#c2a568',
        mountains: '#9a9aa0',
        snow: '#ffffff',
      },
      road: '#c0392b',
      settlement: { village: '#555555', town: '#333333', city: '#000000' },
      ink: 'rgba(20,23,28,0.4)',
      label: '#14171c',
    },
  },
};

const MAP_THEME_DEFAULT = 'parchment';

function populateThemeSelect(selectEl) {
  for (const key in MAP_THEMES) {
    const opt = document.createElement('option');
    opt.value = key;
    opt.textContent = MAP_THEMES[key].label;
    if (key === MAP_THEME_DEFAULT) opt.selected = true;
    selectEl.appendChild(opt);
  }
}
