// Room-content vocabulary for the BSP dungeon generator (views/map-dungeon.js).
// Before this, dungeon rooms were numbers-only by explicit prior design --
// the account owner's own follow-up feedback flagged that as the dungeon's
// first problem, wanting the same "purpose label + light GM lore" treatment
// landmark sites already got (lib/landmark-lore.js). Deliberately a single
// flat vocabulary, not a per-dungeon-type theme table like
// lib/landmark-sites.js: a BSP dungeon has no upstream "genre" signal the
// way a landmark's type is (the overworld already decided a landmark is a
// Ley Line Nexus vs. Sunken Ruins before the click) -- generate() only ever
// receives seed/gw/gh/minSize/maxDepth, so inventing a dungeon-type roll
// here would be new scope, not what was asked. Pools are flat strings (no
// template fill-in, unlike lib/landmark-lore.js's opener template) since
// each purpose/flavor is just one short label/clause.

const ROOM_PURPOSES = [
  'Guard Room', 'Barracks', 'Armory', 'Storeroom', 'Kitchen', 'Larder',
  'Shrine', 'Ossuary', 'Torture Chamber', 'Prison Cell', 'Scriptorium',
  'Emptied Treasury', "Alchemist's Den", 'Trophy Hall', 'Collapsed Passage',
  'Flooded Cistern', 'Mushroom Cellar', 'Bone Pit', 'Ritual Circle',
  'Watch Post', 'Mess Hall', 'Forgotten Shrine', 'Sleeping Quarters',
  'Workshop', 'Kennel', 'Crypt Alcove', 'Meeting Hall', 'Sprung Vault',
  'Overgrown Chamber', 'Nesting Hollow',
];

// Grander labels reserved for the occasional arena/cathedral set-piece room
// (see map-dungeon.js's setpieceRng roll) -- a boss-room moment deserves a
// name that reads as more significant than an ordinary room's.
const SET_PIECE_PURPOSES = ['Grand Hall', 'Sanctum', 'Arena Floor', 'Throne Chamber'];

const FLAVOR_FRAGMENTS = [
  'Dust undisturbed for years, except one set of footprints.',
  'Something scratched deep grooves into the far wall, chest height.',
  'The smell of old smoke lingers, though nothing here has burned.',
  'A faint draft comes from nowhere obvious.',
  'The floor here is noticeably warmer than the passage outside.',
  'Every surface bears the same worn symbol, carved shallow.',
  'A chair, or what is left of one, faces the wrong way.',
  'Cobwebs stretch corner to corner, thick enough to be old.',
  'Something small skitters away the moment light enters.',
  'The air tastes faintly of copper.',
  'Old tally marks cover one wall, the count long since lost.',
  'A single unlit lamp still hangs, oil long gone.',
  'The ceiling here bears a wide, dry water stain.',
  'Bootprints in the dust circle the room and lead back out the way they came.',
  'A cracked basin holds a residue that has never fully dried.',
  'Faded paint on the wall hints at a mural no longer legible.',
  'The silence here feels deliberate, not simply empty.',
  'Claw marks, long healed over with grime, run along the doorframe.',
  'A cold spot lingers in one corner, for no obvious reason.',
  'Loose stones in the floor sound hollow underfoot.',
  'Something was dragged across this floor, not too long ago.',
  'A row of pegs on the wall, all but one still empty.',
  'The dust here has been disturbed in a wide, careful circle.',
  'An old bloodstain has long since gone black and brittle.',
  'A faint, rhythmic dripping comes from somewhere unseen.',
  'The walls here bear tool marks -- someone widened this room by hand.',
  'A child-sized handprint, ash-grey, marks the nearest wall.',
  'Every loose object in the room has been neatly stacked against one wall.',
];

// Reshuffle-on-exhaustion pool pick -- same pattern views/map-landmark.js's
// buildSiteLayout already uses for its own purpose pool: draw without
// replacement until the pool empties, then refill and continue, so within
// one dungeon nothing repeats until every option has been used once.
function drawFromPool(state, key, source, rng) {
  if (!state[key] || state[key].length === 0) state[key] = source.slice();
  const idx = Math.floor(rng() * state[key].length);
  const [value] = state[key].splice(idx, 1);
  return value;
}

// Assigns `.purpose` and `.flavor` to every room, called once per
// generate() after the existing shape-variety/set-piece passes (rooms
// already have `.number`/`.shape` by then). `contentRng` is a dedicated
// stream (own seed offset in map-dungeon.js) so toggling/regenerating this
// never perturbs the underlying layout, door/trap rolls, or vice versa.
function assignDungeonRoomContent(rooms, contentRng) {
  const pools = {};
  for (const room of rooms) {
    const purposeSource = (room.shape === 'arena' || room.shape === 'cathedral') ? SET_PIECE_PURPOSES : ROOM_PURPOSES;
    const purposeKey = (room.shape === 'arena' || room.shape === 'cathedral') ? 'setpiece' : 'purpose';
    room.purpose = drawFromPool(pools, purposeKey, purposeSource, contentRng);
    room.flavor = drawFromPool(pools, 'flavor', FLAVOR_FRAGMENTS, contentRng);
  }
}
