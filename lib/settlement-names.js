// Seeded fantasy settlement-name generator. Syllable/phoneme combination
// rather than a fixed name list, so the small part lists below still
// produce a large number of distinct-feeling names -- driven entirely by
// the rng passed in, so callers control reproducibility (same rng sequence
// -> same names every time, matching the seed-reproducibility every other
// part of these generators already guarantees).
//
// Phoneme sets are keyed by a coarse terrain "flavor" rather than any kind
// of culture/politics model -- there's no borders, no lore, no new note
// kind, just four part-lists that read as differently-toned (harsh vs
// soft vs watery vs neutral) so a generated world's regions feel
// geographically distinct without needing anything beyond word choice.
const SETTLEMENT_NAME_PARTS = {
  plains: {
    prefixes: [
      'Bram', 'Old', 'Fair', 'Stone', 'Oak', 'Red', 'White', 'North',
      'South', 'Wren', 'Green', 'Hal', 'Thorn', 'El', 'Ir', 'Kal',
    ],
    suffixes: [
      'ford', 'shire', 'ton', 'field', 'ridge', 'stead', 'dale', 'bridge',
      'moor', 'crest', 'wick', 'hollow', 'fell', 'brook',
    ],
    citySuffixes: ['shire', 'bridge', 'crest', 'gate', 'hold'],
  },
  mountain: {
    prefixes: [
      'Krag', 'Thorn', 'Grimm', 'Dun', 'Bar', 'Kharz', 'Vor', 'Drak',
      'Skar', 'Ur', 'Grud', 'Mor', 'Black', 'Wolf',
    ],
    suffixes: [
      'hold', 'forge', 'spire', 'keep', 'watch', 'gate', 'deep', 'crag',
      'stone', 'hall', 'peak', 'cairn',
    ],
    citySuffixes: ['spire', 'keep', 'gate', 'hold', 'throne'],
  },
  forest: {
    prefixes: [
      'Wren', 'Sil', 'Elm', 'Fern', 'Wyl', 'Bri', 'Ash', 'Fawn',
      'Thistle', 'Lin', 'Vell', 'Ivy', 'Ravens', 'Green',
    ],
    suffixes: [
      'wood', 'glen', 'hollow', 'brook', 'mere', 'dale', 'leaf', 'bramble',
      'thicket', 'grove', 'glade', 'moss',
    ],
    citySuffixes: ['grove', 'hollow', 'mere', 'dale', 'glen'],
  },
  coastal: {
    prefixes: [
      'Sal', 'Mer', 'Bay', 'Tide', 'Fen', 'Storm', 'Gull', 'Wave',
      'Bri', 'Sil', 'Nor', 'Kel',
    ],
    suffixes: [
      'port', 'haven', 'wick', 'shore', 'bay', 'cove', 'tide', 'reach',
      'sound', 'ford', 'harbor', 'isle',
    ],
    citySuffixes: ['haven', 'reach', 'port', 'sound', 'wick'],
  },
};
const DEFAULT_NAME_CATEGORY = 'plains';

// Which phoneme category a region leans toward, keyed off its dominant
// biome -- deliberately a direct, deterministic mapping (no extra rng)
// rather than a weighted/randomized pick, so "this is a mountain region"
// always reads as harsher-sounding names, not sometimes.
const BIOME_TO_NAME_CATEGORY = {
  mountains: 'mountain', hills: 'mountain',
  forest: 'forest',
  deepwater: 'coastal', shallowwater: 'coastal', beach: 'coastal',
  plains: 'plains', snow: 'plains',
};

// tier is 'village' | 'town' | 'city' -- cities lean toward each category's
// more grandiose suffixes so a glance at the name hints at its importance
// even before the map's own marker size does. `category` is one of the
// SETTLEMENT_NAME_PARTS keys (falls back to the plains set if omitted or
// unrecognized, so an old call site with just (rng, tier) still works).
function generateSettlementName(rng, tier, category) {
  const set = SETTLEMENT_NAME_PARTS[category] || SETTLEMENT_NAME_PARTS[DEFAULT_NAME_CATEGORY];
  const prefix = set.prefixes[Math.floor(rng() * set.prefixes.length)];
  const pool = tier === 'city' ? set.citySuffixes : set.suffixes;
  const suffix = pool[Math.floor(rng() * pool.length)];
  return prefix + suffix;
}

// Seeded multi-source flood-fill over a cell-adjacency graph, partitioning
// cells into `regionCount` naming regions. All regions grow outward one
// adjacency-hop at a time from their seed cell, every frontier advancing
// together each round -- so no single region can race ahead across the
// whole map before the others get a turn. This works over any adjacency
// graph (the Voronoi mesh, or in principle a plain grid), and is purely
// about giving different parts of a generated world a different naming
// flavor -- no borders are drawn, no culture/politics data model involved.
function assignNamingRegions(cells, regionCount, rng) {
  const n = cells.length;
  const regionOf = new Int32Array(n).fill(-1);
  if (n === 0 || regionCount <= 0) return regionOf;

  const k = Math.min(regionCount, n);
  const seedIndices = [];
  const taken = new Set();
  while (seedIndices.length < k) {
    const idx = Math.floor(rng() * n);
    if (taken.has(idx)) continue;
    taken.add(idx);
    seedIndices.push(idx);
  }
  seedIndices.forEach((idx, r) => { regionOf[idx] = r; });

  let frontier = seedIndices.map((idx, r) => ({ idx, region: r }));
  while (frontier.length > 0) {
    const next = [];
    for (const { idx, region } of frontier) {
      for (const nb of cells[idx].neighbors) {
        if (regionOf[nb] === -1) {
          regionOf[nb] = region;
          next.push({ idx: nb, region });
        }
      }
    }
    frontier = next;
  }

  // A disconnected pocket of the adjacency graph (shouldn't happen for a
  // well-formed mesh, but cheap to guard against) falls back to whichever
  // region's seed site is geometrically nearest, so nothing is ever left
  // unclaimed at -1.
  for (let i = 0; i < n; i++) {
    if (regionOf[i] !== -1) continue;
    let best = 0, bestDist = Infinity;
    seedIndices.forEach((seedIdx, r) => {
      const d = (cells[i].x - cells[seedIdx].x) ** 2 + (cells[i].y - cells[seedIdx].y) ** 2;
      if (d < bestDist) { bestDist = d; best = r; }
    });
    regionOf[i] = best;
  }
  return regionOf;
}
