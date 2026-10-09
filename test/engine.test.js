// Coverage for the Campaign page's side of the campaign engine (lib/engine.js and views/jobs.js):
// the wording and path helpers, and the rules the files must keep (credentialed API calls, nothing a
// model wrote ever goes in as markup, scripts loaded in order). The screen itself was exercised in a
// real browser against a fake Worker.
//
//   node test/engine.test.js

var assert = require("assert");
var fs = require("fs");
var path = require("path");
var root = path.join(__dirname, "..");
var H = require(path.join(root, "lib", "engine.js"));

var passed = 0;
function test(name, fn) { fn(); passed++; console.log("ok - " + name); }
function read(file) { return fs.readFileSync(path.join(root, file), "utf8"); }

test("a job's state is one plain line", function () {
  assert.strictEqual(H.stateText({ state: "queued" }), "Waiting for the engine…");
  assert.strictEqual(H.stateText({ state: "running", label: "Writing quest: The Dark Post", total: 6, done: 2, failed: 1 }), "Writing quest: The Dark Post (3 of 6)");
  assert.strictEqual(H.stateText({ state: "running", label: "Building the world", total: 0, done: 0, failed: 0 }), "Building the world");
  assert.strictEqual(H.stateText({ state: "running", cancelling: true, label: "x", total: 4, done: 1, failed: 0 }), "Stopping… (1 of 4)");
  assert.strictEqual(H.stateText({ state: "done", done: 5, failed: 0 }), "5 written");
  assert.strictEqual(H.stateText({ state: "done", done: 5, failed: 1 }), "5 written, 1 could not be written");
  assert.strictEqual(H.stateText({ state: "cancelled", done: 0 }), "Stopped");
  assert.strictEqual(H.stateText({ state: "cancelled", done: 2 }), "Stopped, 2 written");
  assert.strictEqual(H.stateText({ state: "error", error: "The model took too long." }), "The model took too long.");
  assert.strictEqual(H.stateText({ state: "error", error: "" }), "Something went wrong");
  assert.strictEqual(H.stateText(null), "");
});

test("active jobs and the progress bar", function () {
  assert.ok(H.isActive({ state: "queued" }) && H.isActive({ state: "running" }));
  assert.ok(!H.isActive({ state: "done" }) && !H.isActive({ state: "error" }) && !H.isActive({ state: "cancelled" }) && !H.isActive(null));
  assert.strictEqual(H.fraction({ state: "running", total: 4, done: 1, failed: 1 }), 0.5);
  assert.strictEqual(H.fraction({ state: "running", total: 0 }), 0);
  assert.strictEqual(H.fraction({ state: "done", total: 0 }), 1);
  assert.strictEqual(H.fraction({ state: "running", total: 2, done: 5, failed: 0 }), 1);
  assert.strictEqual(H.fraction(null), 0);
});

test("elapsed time", function () {
  assert.strictEqual(H.elapsedText(0, 1000), "");
  assert.strictEqual(H.elapsedText(1000, 1000 + 42000), "42 s");
  assert.strictEqual(H.elapsedText(1000, 1000 + 125000), "2 min 5 s");
  assert.strictEqual(H.elapsedText(1000, 1000 + 180000), "3 min");
  assert.strictEqual(H.elapsedText(1000, 1000 + 3 * 3600000 + 5 * 60000), "3 h 5 min");
});

test("names and paths are safe and predictable", function () {
  assert.strictEqual(H.safeName("The [[Sunken]] Market / East?", "x"), "The Sunken Market East");
  assert.strictEqual(H.safeName("", "Misc"), "Misc");
  assert.strictEqual(H.safeName("..hidden", "x"), "hidden");
  assert.strictEqual(H.safeName("a\u0000b", "x"), "a b");
  assert.strictEqual(H.safeName("x".repeat(200)).length, 80);
  assert.strictEqual(H.filenameFor("Marta Voss"), "Marta Voss.md");
  assert.strictEqual(H.filenameFor("   "), "Untitled.md");
  assert.strictEqual(H.pathFor("Entities/Neutral", "Marta Voss", 1), "Entities/Neutral/Marta Voss.md");
  assert.strictEqual(H.pathFor("Entities/Neutral/", "Marta Voss", 2), "Entities/Neutral/Marta Voss (2).md");
  assert.strictEqual(H.pathFor("", "T", 1), "Misc/T.md");
  assert.strictEqual(H.pathFor("/A/B/", "T", 3), "A/B/T (3).md");
});

test("a draft is filed under its kind's folder, with the location filled in when it has one", function () {
  var loc = { folderTemplate: "Locations/{location}/Areas of Interest" };
  assert.strictEqual(H.folderFor(loc, { Location: "Lanternfall Quay" }), "Locations/Lanternfall Quay/Areas of Interest");
  assert.strictEqual(H.folderFor(loc, {}), "Locations/Misc/Areas of Interest");
  assert.strictEqual(H.folderFor({ folderTemplate: "Entities/{disposition}" }, { Location: "Quay" }), "Entities/Misc");
  assert.strictEqual(H.folderFor({ folderTemplate: "Religion" }, {}), "Religion");
  assert.strictEqual(H.folderFor(undefined, {}), "Misc");
  assert.strictEqual(H.folderFor(loc, { Location: "../../etc" }), "Locations/etc/Areas of Interest", "a location cannot climb out of its folder");
});

test("errors are plain sentences, never the raw code or a stack", function () {
  var e = function (code, extra) { return H.errorText(Object.assign({ data: { error: code } }, extra)); };
  assert.match(e("daily_cap_reached", { data: { error: "daily_cap_reached", left: 3 } }), /3 notes/);
  assert.match(e("daily_cap_reached"), /used up/);
  assert.match(e("engine_disabled"), /switched off/);
  assert.match(e("too_many_jobs"), /several jobs/);
  assert.match(e("queue_full"), /queue is full/);
  assert.match(e("premise_required"), /premise/);
  assert.match(e("brief_required"), /brief/);
  assert.match(e("premise_too_long"), /too long/);
  assert.match(e("something_new"), /something new/);
  assert.match(H.errorText({ code: "unauthenticated" }), /Log in/);
  assert.match(H.errorText({ code: "forbidden" }), /access/);
  assert.match(H.errorText(new Error("x")), /Couldn't reach/);
  assert.match(H.errorText(null), /Couldn't reach/);
});

test("the engine is used only when it is on and running", function () {
  assert.deepStrictEqual(H.engineUsable(null), { use: false, reason: "off" });
  assert.deepStrictEqual(H.engineUsable({ enabled: false }), { use: false, reason: "off" });
  assert.deepStrictEqual(H.engineUsable({ enabled: true, engine: { online: false } }), { use: false, reason: "offline" });
  assert.deepStrictEqual(H.engineUsable({ enabled: true }), { use: false, reason: "offline" });
  assert.deepStrictEqual(H.engineUsable({ enabled: true, engine: { online: true } }), { use: true, reason: "" });
});

test("the files keep to the rules: nothing a model wrote becomes markup, and every call goes through the credentialed Api", function () {
  var jobs = read("views/jobs.js"), lib = read("lib/engine.js");
  assert.strictEqual((jobs.match(/\.innerHTML\s*=|insertAdjacentHTML|document\.write|\beval\(|new Function/g) || []).length, 0, "views/jobs.js");
  assert.strictEqual((lib.match(/\.innerHTML\s*=|insertAdjacentHTML|document\.write|\beval\(|new Function/g) || []).length, 0, "lib/engine.js");
  assert.ok(!/\bfetch\(/.test(jobs) && !/\bfetch\(/.test(lib), "no raw fetch: calls go through Api, which sends the login cookie");
  var paths = lib.match(/Api\.(get|post)\(`?'?\/[^'`)]*/g) || [];
  assert.ok(paths.length >= 7);
  paths.forEach(function (p) { assert.ok(/\/jobs\//.test(p), "unexpected path " + p); });
  assert.ok(/draft\.body\.trim\(\)/.test(read("views/new-note.js")), "the draft body goes in through .value");
  assert.ok(!/setAttribute\(\s*['"]style['"]/.test(jobs), "no style attributes");
});

test("index.html loads the engine files in order and every file shares one version", function () {
  var html = read("index.html");
  var order = ["lib/api.js", "lib/engine.js", "views/campaign.js", "views/jobs.js", "views/new-note.js", "app.js"].map(function (f) { return html.indexOf('src="' + f); });
  assert.ok(order.every(function (i) { return i > 0; }));
  assert.deepStrictEqual(order.slice().sort(function (a, b) { return a - b; }), order);
  var versions = {};
  (html.match(/\?v=\d+/g) || []).forEach(function (v) { versions[v] = 1; });
  assert.strictEqual(Object.keys(versions).length, 1, "mixed versions: " + Object.keys(versions));
});

test("a generated pack never overwrites a note: a name that is taken gets a number", function () {
  var src = read("views/jobs.js");
  assert.ok(/file_exists/.test(src) && /for \(let n = 1; n <= 4/.test(src));
});

console.log("\n" + passed + " tests passed");
