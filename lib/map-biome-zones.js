// Fantasy biome/region variant tables for the overworld map generator
// (views/map-overworld.js). Pure data -- adding a new variant later means
// adding a table row + a palette entry (lib/map-themes.js) + one short
// icon-drawing case (drawWildZoneIcon in map-overworld.js), not new logic.
// All three tables are consumed only when island... no -- when the
// "#ow-wildzones" checkbox is on; every mechanism they drive (region
// flagging, range flagging, point-landmark placement) is additive overlay
// painted AFTER the normal terrain passes, so turning the checkbox off (or
// simply rolling none) leaves the underlying map byte-for-byte what it was
// before this system existed.

// Band-threshold reflavors: recolors/re-icons cells that already match
// `baseBiome` (or, for 'wetlowland', the derived wetlowlandOf flag) within
// one flagged naming-region (views/map-overworld.js's regionOf, reused
// as-is from assignNamingRegions). `forcesSnow` (Frostfell) is a special
// case handled directly in buildWorld, not via paletteKey/washKey/iconKey --
// it overrides refBiome itself rather than recoloring it, so it needs
// neither a new palette entry nor a new icon.
const SPECIAL_ZONE_TYPES = [
  { key: 'ashenForest', label: 'Ashen Forest', baseBiome: 'forest', washKey: 'ashenForest', iconKey: 'ashTree' },
  { key: 'petrifiedWastes', label: 'Petrified Wastes', baseBiome: 'hills', washKey: 'petrifiedWastes', iconKey: 'petrifiedSpire' },
  { key: 'thornwood', label: 'Thornwood', baseBiome: 'forest', washKey: 'thornwood', iconKey: 'bramble' },
  { key: 'fungalForest', label: 'Fungal Forest', baseBiome: 'forest', washKey: 'fungalForest', iconKey: 'mushroomCap' },
  { key: 'boneMarsh', label: 'Bone Marsh', baseBiome: 'wetlowland', washKey: 'boneMarsh', iconKey: 'boneStake' },
  { key: 'feywildBog', label: 'Feywild Bog', baseBiome: 'wetlowland', washKey: 'feywildBog', iconKey: 'wisp' },
  { key: 'bloodstoneDesert', label: 'Bloodstone Desert', baseBiome: 'barrens', washKey: 'bloodstoneDesert', iconKey: 'redRock' },
  { key: 'saltFlats', label: 'Salt Flats', baseBiome: 'barrens', washKey: 'saltFlats', iconKey: 'saltCrust' },
  { key: 'frostfell', label: 'Frostfell', baseBiome: 'any', forcesSnow: true },
];

// Range-seeded: reuses the continent-tier multi-range placement machinery
// (rangeIndexOf in buildWorld) instead of a naming region. `appliesTo`:
// 'range' recolors the whole hillsT+ footprint of that specific range;
// 'rangeBase' only its hillsT..mountainsT band (the foothills, not the
// peak); 'snowOnly' changes nothing but the icon at that range's existing
// snow-cap cells (Cloudpiercer Peaks is pure iconography, no new palette
// needed -- it reuses palette.biomes.snow as-is).
const RANGE_ZONE_TYPES = [
  { key: 'blightedWasteland', label: 'Blighted Wasteland', washKey: 'blightedWasteland', iconKey: 'corruptionTendril', appliesTo: 'range' },
  { key: 'volcanicAshlands', label: 'Volcanic Ashlands', washKey: 'volcanicAshlands', iconKey: 'volcanicVent', appliesTo: 'range' },
  { key: 'crystalWastes', label: 'Crystal Wastes', washKey: 'crystalWastes', iconKey: 'crystalShard', appliesTo: 'range' },
  { key: 'elementalScar', label: 'Elemental Scar', washKey: 'elementalScar', iconKey: 'stormBolt', appliesTo: 'range' },
  { key: 'obsidianFlats', label: 'Obsidian Flats', washKey: 'obsidianFlats', iconKey: 'obsidianShard', appliesTo: 'rangeBase' },
  { key: 'cloudpiercerPeaks', label: 'Cloudpiercer Peaks', iconKey: 'cloudWisp', appliesTo: 'snowOnly' },
];

// Point landmarks: single icon+name markers, extending the pattern already
// shipped in views/map-detail.js's LANDMARK_TYPES (same {key,label}-array-
// per-category shape) with a `rare` flag (lower placement odds) and a
// `placement` field -- 'category' picks a candidate the normal way (land
// cell, biome-category match); 'shallowwaterAdjacent' (Sunken Ruins) uses
// its own filter instead (a land cell neighboring shallowwater).
const POINT_LANDMARK_TYPES = {
  forest: [{ key: 'giantsGarden', label: "Giant's Garden" }],
  mountain: [],
  coastal: [{ key: 'sunkenRuins', label: 'Sunken Ruins', placement: 'shallowwaterAdjacent' }],
  plains: [],
  any: [
    { key: 'leyLineNexus', label: 'Ley Line Nexus', rare: true },
    { key: 'astralScar', label: 'Astral Scar', rare: true },
  ],
};
