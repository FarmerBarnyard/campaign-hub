// Coverage for linking maps and notes (lib/map-link.js): the map note a Save writes, the address it
// reopens, the settlement a Location note draws, and the rules the files must keep. The pages were
// exercised in a real browser against a fake Worker (draw from a Location note, save, name clash,
// open the saved map from its note).
//
//   node test/map-link.test.js

var assert = require("assert");
var fs = require("fs");
var path = require("path");
var root = path.join(__dirname, "..");
var L = require(path.join(root, "lib", "map-link.js"));

var passed = 0;
function test(name, fn) { fn(); passed++; console.log("ok - " + name); }
function read(file) { return fs.readFileSync(path.join(root, file), "utf8"); }

test("the same place always draws the same town, and different places draw different ones", function () {
  assert.strictEqual(L.seedFromTitle("Saltgate"), L.seedFromTitle("Saltgate"));
  assert.notStrictEqual(L.seedFromTitle("Saltgate"), L.seedFromTitle("Lanternfall Quay"));
  var s = L.seedFromTitle("x".repeat(500));
  assert.ok(Number.isInteger(s) && s >= 1 && s <= 2147483646, "a positive 31-bit seed the server accepts");
  assert.ok(L.seedFromTitle("") >= 1);
  assert.ok(L.seedFromTitle(undefined) >= 1);
});

test("a settlement for a note carries the map's own parameters plus where it came from", function () {
  var q = new URLSearchParams(L.settlementParams("Saltgate", "city", "Ashfall"));
  assert.strictEqual(q.get("idx"), "0");
  assert.strictEqual(q.get("name"), "Saltgate");
  assert.strictEqual(q.get("tier"), "city");
  assert.strictEqual(q.get("campaign"), "Ashfall");
  assert.strictEqual(q.get("location"), "Saltgate");
  assert.strictEqual(q.get("seed"), String(L.seedFromTitle("Saltgate")));
  assert.strictEqual(new URLSearchParams(L.settlementParams("X", "castle")).get("tier"), "town", "an unknown size becomes a town");
  assert.strictEqual(L.settlementHash("Saltgate", "town", "Ashfall").indexOf("#/map/settlement?seed="), 0);
  assert.ok(!new URLSearchParams(L.settlementParams("X", "town")).has("campaign"), "no campaign, none written");
});

test("only the map's own parameters are kept when it is saved, never where it was filed from", function () {
  assert.strictEqual(L.mapParamsOnly("seed=1&idx=0&name=A&tier=town&campaign=Ashfall&location=A"), "seed=1&idx=0&name=A&tier=town");
  assert.strictEqual(L.mapParamsOnly(new URLSearchParams("seed=1&campaign=C")), "seed=1");
  assert.strictEqual(L.mapParamsOnly(""), "");
});

test("a map note says what the map is, how to redraw it, and which note it belongs to", function () {
  var n = L.buildMapNote({ route: "map/settlement", params: new URLSearchParams("seed=7&idx=0&name=Saltgate&tier=town&campaign=Ashfall&location=Saltgate"), title: "Saltgate", image: "Saltgate.png", location: "Saltgate" });
  assert.deepStrictEqual(n.frontmatter, { tags: ["M"], Map_Type: "settlement", Map_Route: "map/settlement", Map_Params: "seed=7&idx=0&name=Saltgate&tier=town", Image: "Saltgate.png", Location: "Saltgate" });
  assert.strictEqual(n.title, "Saltgate");
  assert.ok(n.body.indexOf("# Saltgate") === 0);
  assert.ok(n.body.indexOf("![[Saltgate.png]]") > 0, "shows the picture");
  assert.ok(n.body.indexOf("Location: [[Saltgate]]") > 0, "links back to the note");
  assert.ok(/Open map/.test(n.body));
  var plain = L.buildMapNote({ route: "map/settlement", params: "seed=7", title: "Free map", image: "free.png" });
  assert.strictEqual(plain.frontmatter.Location, "");
  assert.ok(plain.body.indexOf("Location:") < 0, "no backlink when there is no location");
});

test("a map that cannot be redrawn from the address is saved without parameters, and says so", function () {
  var n = L.buildMapNote({ route: "map/overworld", params: "seed=1", title: "World", image: "world.png" });
  assert.strictEqual(n.frontmatter.Map_Type, "overworld");
  assert.strictEqual(n.frontmatter.Map_Route, "");
  assert.strictEqual(n.frontmatter.Map_Params, "");
  assert.ok(/cannot be reopened/.test(n.body));
  assert.strictEqual(L.buildMapNote({ route: "map/settlement", params: "seed=1", title: "T" }), null, "no picture, no note");
  assert.strictEqual(L.buildMapNote(null), null);
  // markup characters are re-encoded as a query string, so nothing but plain characters is ever saved
  var enc = L.buildMapNote({ route: "map/settlement", params: "seed=1&x=<script>", title: "T", image: "t.png" }).frontmatter.Map_Params;
  assert.ok(enc.indexOf("<") < 0 && enc.indexOf("%3Cscript%3E") > 0);
  assert.strictEqual(L.buildMapNote({ route: "map/settlement", params: "a=" + "b".repeat(6000), title: "T", image: "t.png" }).frontmatter.Map_Route, "");
});

test("titles and paths are safe", function () {
  assert.strictEqual(L.notePath("Saltgate", 1), "Maps/Saltgate.md");
  assert.strictEqual(L.notePath("Saltgate", 3), "Maps/Saltgate (3).md");
  assert.strictEqual(L.notePath("a/b:c*?", 1), "Maps/a b c.md");
  assert.strictEqual(L.notePath("", 1), "Maps/Map.md");
  assert.strictEqual(L.notePath("../../etc", 1), "Maps/etc.md");
  var n = L.buildMapNote({ route: "map/settlement", params: "seed=1", title: "[[Evil]]", image: "e.png", location: "A [[B]] | C" });
  assert.ok(!/\[\[Evil\]\]/.test(n.title) && n.frontmatter.Location.indexOf("[") < 0 && n.frontmatter.Location.indexOf("|") < 0);
});

test("a map note reopens only a known generator with a plain query string", function () {
  var ok = { Map_Route: "map/settlement", Map_Params: "seed=7&idx=0&name=Saltgate%20Quay&tier=town" };
  assert.strictEqual(L.mapHash(ok), "#/map/settlement?seed=7&idx=0&name=Saltgate%20Quay&tier=town");
  assert.strictEqual(L.mapHash({ Map_Route: "map/detail", Map_Params: "seed=1&guide=AbC+/x=" .replace("/", "%2F") }) !== null, true);
  assert.strictEqual(L.mapHash({ Map_Route: "map/overworld", Map_Params: "seed=7" }), null, "not driven by the address");
  assert.strictEqual(L.mapHash({ Map_Route: "#/evil", Map_Params: "seed=7" }), null);
  assert.strictEqual(L.mapHash({ Map_Route: "map/settlement", Map_Params: "seed=7&x=javascript:alert(1)" }), null, "a colon is not in a plain query string");
  assert.strictEqual(L.mapHash({ Map_Route: "map/settlement", Map_Params: 'seed=7"onclick="x' }), null);
  assert.strictEqual(L.mapHash({ Map_Route: "map/settlement", Map_Params: "" }), null);
  assert.strictEqual(L.mapHash({ Map_Route: "map/settlement", Map_Params: "a=" + "b".repeat(6000) }), null);
  assert.strictEqual(L.mapHash({ Map_Route: ["map/settlement"], Map_Params: "seed=1" }), null);
  assert.strictEqual(L.mapHash({}), null);
  assert.strictEqual(L.mapHash(null), null);
});

test("what a map note saves is exactly what it reopens", function () {
  var params = new URLSearchParams("seed=2023872551&idx=3&name=Old Port&tier=city&x=120.5&y=88&h=0.5&m=0.4&sea=0.42&coastal=1&campaign=Ashfall&location=Old Port");
  var n = L.buildMapNote({ route: "map/settlement", params: params, title: "Old Port", image: "Old Port.png", location: "Old Port" });
  var hash = L.mapHash(n.frontmatter);
  var again = new URLSearchParams(hash.split("?")[1]);
  assert.strictEqual(again.get("name"), "Old Port");
  assert.strictEqual(again.get("idx"), "3");
  assert.strictEqual(again.get("coastal"), "1");
  assert.ok(!again.has("campaign") && !again.has("location"));
});

test("only Location notes offer a settlement", function () {
  assert.strictEqual(L.isLocation({ tags: ["A"] }), true);
  assert.strictEqual(L.isLocation({ tags: "A" }), true);
  assert.strictEqual(L.isLocation({ tags: ["E"] }), false);
  assert.strictEqual(L.isLocation({ tags: ["M"] }), false, "a map note is not a Location");
  assert.strictEqual(L.isLocation({}), false);
  assert.strictEqual(L.isLocation(null), false);
});

test("the files keep to the rules: loaded in order, no markup from note text, the generator's headless path is untouched", function () {
  var html = read("index.html");
  var order = ["lib/api.js", "lib/map-link.js", "views/campaign.js", "views/map-dungeon.js", "views/map-settlement.js", "app.js"].map(function (f) { return html.indexOf('src="' + f); });
  assert.ok(order.every(function (i) { return i > 0; }));
  assert.deepStrictEqual(order.slice().sort(function (a, b) { return a - b; }), order);
  var versions = {};
  (html.match(/\?v=\d+/g) || []).forEach(function (v) { versions[v] = 1; });
  assert.strictEqual(Object.keys(versions).length, 1, "mixed versions");
  var lib = read("lib/map-link.js");
  assert.strictEqual((lib.match(/\.innerHTML\s*=|insertAdjacentHTML|document\.write|\beval\(|new Function/g) || []).length, 0);
  var st = read("views/map-settlement.js");
  // the render service runs this view without lib/map-link.js: it must only be reached for a request that came from a note
  assert.ok(/if \(fromLocation\) container\.querySelector\('#st-filename'\)\.value = MapLink\.safeName/.test(st));
  assert.ok(/location: fromLocation \}\)\);/.test(st), "the map info is a function, evaluated only when Save is pressed");
  // the generator's own parameters sent to the server never include where the map was filed from
  var m = /function serverParams\(\) \{[\s\S]*?\n  \}/.exec(st)[0];
  assert.ok(!/campaign|location/.test(m.replace(/\/\/.*$/gm, "")), "serverParams must not forward campaign or location");
  var camp = read("views/campaign.js");
  assert.ok(/MapLink\.mapHash\(note\.frontmatter\)/.test(camp) && /MapLink\.isLocation\(note\.frontmatter\)/.test(camp));
  assert.ok(!/innerHTML[^;]*note\.frontmatter\.Map/.test(camp), "map parameters never go through innerHTML");
});

test("saving a map note never undoes the picture, and a taken name gets a number", function () {
  var src = read("views/map-dungeon.js");
  assert.ok(/for \(let n = 1; n <= 4 && !savedAs; n\+\+\)/.test(src));
  assert.ok(/the map note could not be saved/.test(src));
  assert.ok(src.indexOf("/map/save-image") < src.indexOf("MapLink.buildMapNote"), "the picture is saved first");
});

console.log("\n" + passed + " tests passed");
