// The shared "Render on server" toggle (lib/server-map.js ServerMap.attach) that the zoom-window, detail,
// landmark and dungeon pages use, and the mapgen audit gate that decides each type may be switched on.
//
//   node test/server-map.test.js
//
// Plain Node, standard library only, like the other tests here.

var assert = require("assert");
var fs = require("fs");
var path = require("path");
var root = path.join(__dirname, "..");
var src = fs.readFileSync(path.join(root, "lib", "server-map.js"), "utf8");

var passed = 0;
var pending = [];
function test(name, fn) {
  pending.push(Promise.resolve().then(fn).then(function () { passed++; console.log("ok - " + name); }));
}

// A page in miniature: the checkbox, the status line, a canvas that records what is drawn on it.
function page() {
  var listeners = {};
  var box = { checked: false, addEventListener: function (ev, fn) { listeners[ev] = fn; } };
  var status = { textContent: "" };
  var drawn = [];
  var ctx = { clearRect: function () {}, drawImage: function (img) { drawn.push(img); } };
  var canvas = { width: 800, height: 600, getContext: function () { return ctx; } };
  var container = { querySelector: function (sel) { return sel === "#xx-server" ? box : sel === "#xx-server-status" ? status : null; } };
  var overlays = { open: 0, closed: 0 };
  var ServerMap = new Function("Api", "API_BASE", "showGenerationProgress", "Image", "document", "DOMParser",
    src + "\nreturn ServerMap;")({}, "https://api.example/campaign", function () {
    overlays.open++;
    return { done: function () { overlays.closed++; } };
  });
  return { box: box, status: status, drawn: drawn, canvas: canvas, container: container, listeners: listeners, ServerMap: ServerMap, overlays: overlays };
}

function attach(p, extra) {
  var calls = { regenerate: 0, results: [] };
  var api = p.ServerMap.attach(Object.assign({
    container: p.container, prefix: "xx", canvas: p.canvas, type: "dungeon",
    params: function () { return { seed: "5" }; }, theme: function () { return "parchment"; },
    regenerate: function () { calls.regenerate++; },
    onResult: function (r) { calls.results.push(r); },
  }, extra || {}));
  return { api: api, calls: calls };
}

const tick = (p) => { p.box.checked = true; p.listeners.change(); };
const flush = () => new Promise((r) => setTimeout(r, 0));

test("toggleHtml gives the ids attach looks for, for each view prefix", function () {
  var p = page();
  var html = p.ServerMap.toggleHtml("lm");
  assert.ok(html.indexOf('id="lm-server"') !== -1 && html.indexOf('id="lm-server-status"') !== -1);
  assert.ok(html.indexOf('type="checkbox"') !== -1);
});

test("ticking draws the server's picture and untick/refresh/export follow", async function () {
  var p = page();
  var sent = [];
  p.ServerMap.render = async function (req) { sent.push(req); return { cached: false, displayUrl: "/d", masterUrl: "/m", meta: { meta: {} } }; };
  p.ServerMap.loadImage = async function (u) { return { url: u }; };
  var a = attach(p);
  assert.equal(a.api.active(), false, "off until ticked");
  tick(p); await flush();
  assert.equal(a.api.active(), true);
  assert.deepEqual(sent[0], { type: "dungeon", params: { seed: "5" }, scale: 2, theme: "parchment" });
  assert.equal(p.drawn.length, 1);
  assert.equal(p.drawn[0].url, "/d");
  assert.equal(p.status.textContent, "Rendered on server.");
  assert.equal(a.calls.results.length, 1, "onResult fills the side panels");
  assert.equal(p.overlays.open, p.overlays.closed, "the progress overlay always closes");

  var master = [];
  assert.equal(await a.api.drawMaster({ drawImage: function (img) { master.push(img); } }), true);
  assert.equal(master[0].url, "/m", "export uses the stored 2x master");

  a.api.refresh(); await flush();
  assert.equal(sent.length, 2, "a theme change re-renders while server mode is on");

  p.box.checked = false; p.listeners.change();
  assert.equal(a.api.active(), false);
  assert.equal(a.calls.regenerate, 1, "unticking redraws in the browser");
  assert.equal(await a.api.drawMaster({}), false, "and the export then redraws locally");
  a.api.refresh(); await flush();
  assert.equal(sent.length, 2, "refresh does nothing when server mode is off");
});

test("a failure unticks the box, says why, and falls back to the in-browser render", async function () {
  var p = page();
  p.ServerMap.render = async function () { var e = new Error("x"); e.data = { error: "busy" }; throw e; };
  var a = attach(p);
  tick(p); await flush();
  assert.equal(p.box.checked, false);
  assert.equal(a.api.active(), false);
  assert.equal(a.calls.regenerate, 1);
  assert.ok(/busy/.test(p.status.textContent));
  assert.equal(p.overlays.open, p.overlays.closed);
});

test("a slow answer that has been overtaken (box unticked meanwhile) is thrown away", async function () {
  var p = page();
  var release;
  p.ServerMap.render = function () { return new Promise(function (r) { release = function () { r({ cached: true, displayUrl: "/d", masterUrl: "/m", meta: { meta: {} } }); }; }); };
  p.ServerMap.loadImage = async function (u) { return { url: u }; };
  var a = attach(p);
  tick(p);
  p.box.checked = false; p.listeners.change();
  release(); await flush();
  assert.equal(a.api.active(), false, "the late result does not switch server mode back on");
  assert.equal(p.drawn.length, 0, "and does not paint over the browser's map");
});

test("every map page that offers the toggle builds it from the shared helper", function () {
  var views = { "map-window.js": "dt", "map-detail.js": "dt", "map-landmark.js": "lm", "map-dungeon.js": "dg" };
  Object.keys(views).forEach(function (file) {
    var text = fs.readFileSync(path.join(root, "views", file), "utf8");
    assert.ok(text.indexOf("ServerMap.toggleHtml('" + views[file] + "')") !== -1, file + " has the checkbox");
    assert.ok(text.indexOf("prefix: '" + views[file] + "'") !== -1, file + " attaches it");
    assert.ok(/server\.drawMaster\(offCtx\)/.test(text), file + " exports the server master when it is on");
  });
  var win = fs.readFileSync(path.join(root, "views", "map-window.js"), "utf8");
  assert.ok(/w\.continent \? null : ServerMap\.attach/.test(win), "continent-scale zooms are never sent to the server");
});

test("the mapgen sandbox loads the helper the views call while they set up", function () {
  var loader = fs.readFileSync(path.join(root, "mapgen", "src", "load-generators.js"), "utf8");
  assert.ok(loader.indexOf("'lib/server-map.js'") !== -1);
});

test("the mapgen and Worker whitelists agree on the params the new map types send", function () {
  var server = fs.readFileSync(path.join(root, "mapgen", "src", "server.js"), "utf8");
  ["zone", "poi", "poiLabel", "poiName", "tile", "dw", "dh", "dmin", "ddepth"].forEach(function (k) {
    assert.ok(server.indexOf("'" + k + "'") !== -1, k + " is allowed through to the generators");
  });
});

Promise.all(pending).then(function () { console.log(passed + " passed"); }, function (e) { console.error(e); process.exit(1); });
