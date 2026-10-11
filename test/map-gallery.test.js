// The map gallery's pure parts (lib/map-gallery.js) and its wiring into the page.
//
//   node test/map-gallery.test.js
//
// Plain Node, standard library only, like the other tests here.

var assert = require("assert");
var fs = require("fs");
var path = require("path");
var root = path.join(__dirname, "..");
var MapGallery = require(path.join(root, "lib", "map-gallery.js"));
var MapLink = require(path.join(root, "lib", "map-link.js"));

var passed = 0;
function test(name, fn) { fn(); passed++; console.log("ok - " + name); }

function note(fm) { return { frontmatter: fm, body: "" }; }

test("the map notes in a Maps/ listing are the .md files, in name order", function () {
  var names = MapGallery.mapNoteNames({ dirs: ["old"], files: [{ name: "Saltgate.md" }, { name: "Saltgate.png" }, { name: "Ashen Keep (2).md" }, { name: "Crypt.MD" }, null, { size: 4 }] });
  assert.deepStrictEqual(names, ["Ashen Keep (2).md", "Crypt.MD", "Saltgate.md"]);
  assert.deepStrictEqual(MapGallery.mapNoteNames(null), []);
  assert.deepStrictEqual(MapGallery.mapNoteNames({ files: "nope" }), []);
});

test("a map note is one tagged M or carrying a Map_Type; an ordinary note is not", function () {
  assert.strictEqual(MapGallery.isMapNote({ tags: ["M"], Map_Type: "settlement" }), true);
  assert.strictEqual(MapGallery.isMapNote({ tags: "M" }), true);
  assert.strictEqual(MapGallery.isMapNote({ Map_Type: "dungeon" }), true);
  assert.strictEqual(MapGallery.isMapNote({ tags: ["A"] }), false);
  assert.strictEqual(MapGallery.isMapNote({ tags: [], Map_Type: "" }), false);
  assert.strictEqual(MapGallery.isMapNote(null), false);
});

test("a card carries the title from the file name, the kind, the picture's bare name and where to reopen it", function () {
  var built = MapLink.buildMapNote({ route: "map/settlement", params: "seed=5&idx=0&name=Saltgate&tier=town", title: "Saltgate", image: "Saltgate.png", location: "Saltgate" });
  var c = MapGallery.cardFrom("Aria", "Maps/Saltgate.md", note(built.frontmatter), MapLink.mapHash(built.frontmatter));
  assert.deepStrictEqual([c.campaign, c.path, c.title, c.type, c.typeLabel, c.image, c.location], ["Aria", "Maps/Saltgate.md", "Saltgate", "settlement", "Settlement", "Saltgate.png", "Saltgate"]);
  assert.strictEqual(c.reopen, "#/map/settlement?seed=5&idx=0&name=Saltgate&tier=town");
});

test("a card for a map that cannot be reopened, or has no picture, is still a card", function () {
  var dungeon = MapGallery.cardFrom("Aria", "Maps/Crypt.md", note({ tags: ["M"], Map_Type: "dungeon", Image: "Images/Crypt.png" }), null);
  assert.strictEqual(dungeon.reopen, null);
  assert.strictEqual(dungeon.image, "Crypt.png", "a folder in front of the name is dropped: the image route takes the bare name");
  var odd = MapGallery.cardFrom("Aria", "Maps/x.md", note({ tags: ["M"] }), null);
  assert.deepStrictEqual([odd.type, odd.typeLabel, odd.image, odd.location], ["other", "Other", "", ""]);
  assert.strictEqual(MapGallery.cardFrom("A", "Maps/y.md", null, null).title, "y");
});

test("filters: by kind, by a word in the title or the place, and both together", function () {
  var cards = [
    { title: "Saltgate", type: "settlement", location: "Saltgate" }, { title: "Ashen Keep", type: "settlement", location: "Ashen Vale" },
    { title: "Crypt", type: "dungeon", location: "" }, { title: "The Drowned Hall", type: "landmark", location: "Saltgate coast" },
  ];
  assert.strictEqual(MapGallery.filterCards(cards, { type: "all", text: "" }).length, 4);
  assert.strictEqual(MapGallery.filterCards(cards, { type: "settlement" }).length, 2);
  assert.deepStrictEqual(MapGallery.filterCards(cards, { text: "salt" }).map(function (c) { return c.title; }), ["Saltgate", "The Drowned Hall"], "the place counts");
  assert.deepStrictEqual(MapGallery.filterCards(cards, { type: "landmark", text: " SALT " }).map(function (c) { return c.title; }), ["The Drowned Hall"]);
  assert.strictEqual(MapGallery.filterCards(cards, { type: "dungeon", text: "salt" }).length, 0);
  assert.deepStrictEqual(MapGallery.filterCards(null, null), []);
});

test("counts per kind for the filter buttons, and the summary line says how many and when it stopped", function () {
  var counts = MapGallery.countsByType([{ type: "settlement" }, { type: "settlement" }, { type: "dungeon" }, { type: "other" }]);
  assert.deepStrictEqual(counts, { all: 4, settlement: 2, dungeon: 1, other: 1 });
  assert.strictEqual(MapGallery.summaryText(0, 0, false), "No saved maps in this campaign yet.");
  assert.strictEqual(MapGallery.summaryText(1, 1, false), "1 map.");
  assert.strictEqual(MapGallery.summaryText(5, 5, false), "5 maps.");
  assert.strictEqual(MapGallery.summaryText(5, 2, false), "2 of 5 maps.");
  assert.match(MapGallery.summaryText(80, 60, true), /^80 maps saved; showing the first 60/);
});

test("the gallery is wired into the page: a route, a nav tab, the scripts, no inline script or style", function () {
  var app = fs.readFileSync(path.join(root, "app.js"), "utf8");
  assert.ok(app.indexOf("'maps': renderMapGallery") !== -1, "a route");
  assert.ok(app.indexOf("route === 'maps'") !== -1, "the tab stays highlighted");
  var html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  assert.ok(html.indexOf('href="#/maps"') !== -1, "a nav link");
  assert.ok(html.indexOf("lib/map-gallery.js") !== -1 && html.indexOf("views/map-gallery.js") !== -1);
  assert.ok(html.indexOf("lib/map-gallery.js") < html.indexOf("views/map-gallery.js") && html.indexOf("views/map-gallery.js") < html.indexOf("app.js"), "loaded before the router");
  var view = fs.readFileSync(path.join(root, "views", "map-gallery.js"), "utf8");
  assert.ok(!/\.innerHTML\s*[+]?=\s*[^`'"]/.test(view.replace(/container\.innerHTML = `[\s\S]*?`;/, "")), "server text never goes through innerHTML");
  assert.ok(view.indexOf("crossOrigin = 'use-credentials'") !== -1 && view.indexOf("crossOrigin") < view.indexOf("img.src"), "pictures are loaded with the cookie, set before src");
});

console.log("\n" + passed + " passed");
