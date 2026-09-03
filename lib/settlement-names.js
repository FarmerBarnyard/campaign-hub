// Seeded fantasy settlement-name generator. Syllable/phoneme combination
// rather than a fixed name list, so the small part lists below still
// produce a large number of distinct-feeling names -- driven entirely by
// the rng passed in, so callers control reproducibility (same rng sequence
// -> same names every time, matching the seed-reproducibility every other
// part of these generators already guarantees).
const SETTLEMENT_NAME_PARTS = {
  prefixes: [
    'Bri', 'Kal', 'Thorn', 'Wyn', 'Ash', 'Dun', 'El', 'Grim', 'Hal', 'Ir',
    'Lor', 'Mor', 'Old', 'Ravens', 'Sil', 'Storm', 'Vel', 'Wolf', 'Green',
    'Black', 'Fair', 'Stone', 'Oak', 'Red', 'White', 'North', 'South', 'Fen',
    'Bram', 'Wren',
  ],
  suffixes: [
    'ford', 'haven', 'wick', 'mere', 'hold', 'burg', 'shire', 'ton', 'reach',
    'gate', 'fell', 'moor', 'dale', 'crest', 'watch', 'spire', 'hollow',
    'bridge', 'stead', 'wood', 'port', 'field', 'ridge', 'brook', 'keep',
  ],
};

// tier is 'village' | 'town' | 'city' -- cities lean toward the more
// grandiose suffixes (gate/spire/reach/keep/burg) so a glance at the name
// hints at its importance even before the map's own marker size does.
const CITY_SUFFIXES = ['gate', 'spire', 'reach', 'keep', 'burg', 'hold', 'watch'];

function generateSettlementName(rng, tier) {
  const prefix = SETTLEMENT_NAME_PARTS.prefixes[Math.floor(rng() * SETTLEMENT_NAME_PARTS.prefixes.length)];
  const pool = tier === 'city' ? CITY_SUFFIXES : SETTLEMENT_NAME_PARTS.suffixes;
  const suffix = pool[Math.floor(rng() * pool.length)];
  return prefix + suffix;
}
