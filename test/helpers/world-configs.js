// The worlds the overworld tests build. Standard tier (800x600) at several cell counts and
// slider settings, plus Continent tier (1600x1200, above the 70,000-cell threshold) so the
// multi-range branch is covered too.
module.exports = [
  { name: "std-1-island", seed: 1, cells: 10000, octaves: 4, island: true, sea: 0.42, rivers: true, settle: 6, width: 800, height: 600 },
  { name: "std-42-island", seed: 42, cells: 40000, octaves: 4, island: true, sea: 0.42, rivers: true, settle: 6, width: 800, height: 600 },
  { name: "std-5005-noisland", seed: 5005, cells: 20000, octaves: 5, island: false, sea: 0.38, rivers: true, settle: 10, width: 800, height: 600 },
  { name: "std-777-norivers", seed: 777, cells: 15000, octaves: 3, island: true, sea: 0.5, rivers: false, settle: 3, width: 800, height: 600 },
  { name: "std-271828-wet", seed: 271828, cells: 30000, octaves: 4, island: true, sea: 0.3, rivers: true, settle: 12, width: 800, height: 600 },
  { name: "cont-1001", seed: 1001, cells: 90000, octaves: 4, island: true, sea: 0.42, rivers: true, settle: 20, width: 1600, height: 1200 },
  { name: "cont-8008", seed: 8008, cells: 100000, octaves: 4, island: true, sea: 0.42, rivers: true, settle: 20, width: 1600, height: 1200 },
];
