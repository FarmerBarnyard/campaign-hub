// Suggests a campaign theme/hook from a generated overworld map's own
// statistics -- deliberately a client-side heuristic rule table, not
// LLM-backed: instant, fully deterministic (same seed -> same stats ->
// same candidate set), and zero infrastructure cost, unlike every actual
// Worker route this project has. A v2 could reuse the existing Ollama
// generate-draft infrastructure for a richer, LLM-composed suggestion, but
// that's a real scope jump (Worker route + security review) not assumed
// here.
//
// Rules are evaluated as a set, not a priority list: every rule whose
// `match` returns true is a candidate, and the caller's rng picks one for
// variety when several qualify. This keeps rule authoring simple (no need
// to reason about ordering/precedence between rules) at the cost of needing
// a dedicated rng stream at the call site, same isolation convention as
// every other generative concern in these map generators.
const CAMPAIGN_THEME_DEFAULT = "A realm of its own quiet character -- no single feature dominates it yet, so the story is free to define what this land becomes.";

const CAMPAIGN_THEME_RULES = [
  {
    match: (s) => (s.biome.mountains + s.biome.hills) > 0.45 && s.settlementCount <= 4,
    theme: "Frontier survival in an unforgiving highland -- isolated holds cling to the high passes, and the wilderness between them belongs to worse things than weather.",
  },
  {
    match: (s) => (s.biome.mountains + s.biome.hills) > 0.45,
    theme: "A realm of mountain kingdoms and hard-won passes -- every road is a chokepoint, and whoever holds the high ground holds the map.",
  },
  {
    match: (s) => s.biome.forest > 0.45,
    theme: "An ancient, watchful woodland presses in on every hold -- the old paths remember more than the people who walk them.",
  },
  {
    match: (s) => s.biome.snow > 0.25,
    theme: "A harsh, frozen frontier where survival itself is the first act of heroism, long before any quest begins.",
  },
  {
    match: (s) => s.islandMode && s.settlementCount <= 2,
    theme: "A castaway's frontier -- a handful of holds cling to a lonely island, cut off from the wider world by leagues of open water.",
  },
  {
    match: (s) => s.islandMode && s.tierCounts.city >= 2,
    theme: "A maritime realm of island city-states, bound together by shipping lanes as much as any crown -- and just as easily torn apart by them.",
  },
  {
    match: (s) => s.coastalSettlementFraction >= 0.6 && s.settlementCount >= 3,
    theme: "Trade rivalries and naval intrigue among rival port cities -- fortunes are made and lost on the tide, and every harbor has its smugglers.",
  },
  {
    match: (s) => s.riverCount >= 6 && s.coastalSettlementFraction < 0.6,
    theme: "A land shaped by its waterways -- every road follows a river, and every old rivalry follows a road.",
  },
  {
    match: (s) => s.riverCount >= 4 && s.beachFraction > 0.05,
    theme: "Where river meets sea, fortunes are made -- a delta of trade routes, smugglers, and competing tariffs.",
  },
  {
    match: (s) => s.tierCounts.city >= 3,
    theme: "A contested heartland of rival crowns -- too many capitals for one map, and every one of them wants the others gone.",
  },
  {
    match: (s) => s.settlementCount <= 2,
    theme: "An untamed wilderness barely touched by civilization -- the frontier itself is the adventure, long before anyone reaches a town.",
  },
  {
    match: (s) => s.tierCounts.town === 0 && s.tierCounts.city === 0 && s.tierCounts.village > 0,
    theme: "A land of scattered, self-reliant villages -- no crown claims it firmly, and that suits the locals fine.",
  },
  {
    match: (s) => s.biome.plains > 0.5,
    theme: "A fertile heartland of farms and market towns -- peaceful on the surface, but old grudges between neighboring lords run deep underneath.",
  },
];

function suggestCampaignTheme(stats, rng) {
  const matches = CAMPAIGN_THEME_RULES.filter((rule) => rule.match(stats));
  if (matches.length === 0) return CAMPAIGN_THEME_DEFAULT;
  return matches[Math.floor(rng() * matches.length)].theme;
}
