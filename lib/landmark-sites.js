// Per-landmark-type site generation theming -- same "keyed table drives
// variance" pattern as lib/map-biome-zones.js's SPECIAL_ZONE_TYPES/
// POINT_LANDMARK_TYPES, but for the *structured site layout* views/
// map-landmark.js generates, not the overworld's icon/wash overlay. Keys
// here match POINT_LANDMARK_TYPES' own keys exactly (leyLineNexus/
// astralScar/giantsGarden/sunkenRuins) so a clicked landmark's `key` looks
// up its site theme directly, no translation table needed.
//
// `roomCount` is a [min,max] room-count range -- landmark sites are meant to
// read as a single explorable location, not a full dungeon crawl, so this
// stays far below map-dungeon.js's own room counts (which can run into the
// dozens at max split depth).
// `shapePool` is which lib/room-shapes.js carvers this type favors, picked
// per-room instead of the dungeon generator's flat/uniform roll -- this is
// what makes the four types read as visibly different floor plans, not just
// different paint. `'rect'` is always implicitly available as the
// uncarved/no-reroll default alongside whatever's listed here.
// `centralPurpose` labels the site's single largest/heart room (where its
// drawWildZoneIcon glyph is drawn, see views/map-landmark.js).
// `roomPurposes` are the labels every other room draws from (shuffled,
// no repeats until exhausted) -- this is the concrete "purpose vocabulary,
// not just geometry" piece the account owner asked for.
// `accentWashKey` names the lib/map-themes.js wash entry (added per-theme
// alongside the existing wild-zone wash colors) used to tint the site
// inset's floor fill.
const LANDMARK_SITE_THEMES = {
  leyLineNexus: {
    roomCount: [4, 6],
    shapePool: ['circle', 'octagon', 'cave'],
    centralPurpose: 'Nexus Heart',
    roomPurposes: ['Conduit Chamber', 'Resonance Well', 'Attunement Circle', 'Warded Antechamber', 'Collapsed Spoke', 'Scrying Alcove'],
    accentWashKey: 'leyLineNexus',
  },
  astralScar: {
    roomCount: [3, 5],
    shapePool: ['cave', 'lshape'],
    centralPurpose: 'Rift Chamber',
    roomPurposes: ['Fractured Hall', 'Voidtouched Cell', 'Shattered Passage', 'Displaced Vault'],
    accentWashKey: 'astralScar',
  },
  giantsGarden: {
    roomCount: [4, 7],
    shapePool: ['cave', 'circle'],
    centralPurpose: 'Overgrown Grove',
    roomPurposes: ['Sunken Basin', 'Bramble Maze', 'Ancient Trellis', 'Root Hollow', "Giant's Seat", 'Mossy Colonnade'],
    accentWashKey: 'giantsGarden',
  },
  sunkenRuins: {
    roomCount: [4, 6],
    shapePool: ['rect', 'octagon'],
    centralPurpose: 'Flooded Hall',
    roomPurposes: ['Collapsed Vault', 'Barnacled Colonnade', 'Silt-Choked Cell', 'Drowned Archive', 'Tideworn Stair'],
    accentWashKey: 'sunkenRuins',
  },
};
