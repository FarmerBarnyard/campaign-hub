// The "Zoom to an area" tool (views/map-zoom-select.js) driven through fake elements and events:
// placing a box by click or drag, the keyboard, the zoom list, opening the map and starting over.
// The geometry it uses has its own tests in test/map-window.test.js.
//
//   node test/zoom-select.test.js

var assert = require("assert");
var fs = require("fs");
var path = require("path");
var vm = require("vm");
var root = path.join(__dirname, "..");

var passed = 0;
function test(name, fn) { fn(); passed++; console.log("ok - " + name); }

function fakeElement(extra) {
  var handlers = {};
  var el = {
    handlers: handlers, style: {}, hidden: false, disabled: false, textContent: "", value: "",
    attrs: {}, classes: {},
    addEventListener: function (type, fn, capture) { (handlers[type] = handlers[type] || []).push({ fn: fn, capture: !!capture }); },
    setAttribute: function (k, v) { this.attrs[k] = v; },
    removeAttribute: function (k) { delete this.attrs[k]; },
    classList: { toggle: function (c, on) { el.classes[c] = !!on; } },
    focus: function () { el.focused = true; },
    setPointerCapture: function () {},
    // fires capture handlers first, like the browser does at the target; stops if one stops immediately
    fire: function (type, evt) {
      evt = evt || {};
      evt.type = type;
      var stopped = false;
      evt.stopImmediatePropagation = function () { stopped = true; };
      evt.preventDefault = evt.preventDefault || function () {};
      var list = (handlers[type] || []).slice().sort(function (a, b) { return (b.capture ? 1 : 0) - (a.capture ? 1 : 0); });
      for (var i = 0; i < list.length && !stopped; i++) list[i].fn(evt);
      return evt;
    },
  };
  Object.keys(extra || {}).forEach(function (k) { el[k] = extra[k]; });
  return el;
}

// A canvas drawn at 800x600 and shown at 400x300 (half size), 1px border, at (100, 50) on the page.
function setup(settings) {
  var wrap = fakeElement();
  var canvas = fakeElement({
    width: 800, height: 600, clientWidth: 400, clientHeight: 300, clientLeft: 1, clientTop: 1, parentElement: wrap, isConnected: true,
    getBoundingClientRect: function () { return { left: 100, top: 50 }; },
  });
  var els = {
    "#ow-zoom-tool": fakeElement({ textContent: "Select an area" }),
    "#ow-zoom-level": fakeElement({ value: "4" }),
    "#ow-zoom-go": fakeElement({ disabled: true }),
    "#ow-zoom-status": fakeElement(),
    "#ow-select-box": fakeElement({ hidden: true }),
  };
  var container = { querySelector: function (sel) { return els[sel]; } };
  var opened = [];
  var ctx = vm.createContext({ window: { addEventListener: function () {} }, Math: Math, Object: Object, Number: Number, parseFloat: parseFloat });
  vm.runInContext(fs.readFileSync(path.join(root, "lib", "map-window.js"), "utf8").replace("const MapWindow =", "var MapWindow ="), ctx);
  vm.runInContext(fs.readFileSync(path.join(root, "views", "map-zoom-select.js"), "utf8").replace(/^function wireZoomSelect/m, "var wireZoomSelect = function"), ctx);
  var hooks = {
    settings: function () { return settings === undefined ? { seed: 7, cells: 40000, octaves: 4, island: true, rivers: true, settle: 6, sea: 0.42, forestBias: 0, ruggedBias: 0, wildZones: true, continent: false } : settings; },
    cellsAcross: function (w) { return w.ww * 231; },
    open: function (win) { opened.push(win); },
  };
  var tool = ctx.wireZoomSelect(container, canvas, hooks);
  // a page point (x, y) inside the shown canvas, as a pointer event
  var pt = function (cx, cy) { return { clientX: 100 + 1 + cx / 2, clientY: 50 + 1 + cy / 2, pointerId: 1, pointerType: "mouse", button: 0 }; };
  return { tool: tool, canvas: canvas, wrap: wrap, els: els, opened: opened, pt: pt };
}

test("turning the tool on shows how to use it and takes focus", function () {
  var s = setup();
  s.els["#ow-zoom-tool"].fire("click");
  assert.strictEqual(s.els["#ow-zoom-tool"].attrs["aria-pressed"], "true");
  assert.strictEqual(s.wrap.classes.selecting, true);
  assert.ok(s.canvas.focused);
  assert.ok(/Drag a box/.test(s.els["#ow-zoom-status"].textContent));
  assert.strictEqual(s.els["#ow-zoom-go"].disabled, true, "nothing to open yet");
});

test("a click drops a box of the chosen zoom centred on the click, in canvas pixels", function () {
  var s = setup();
  s.els["#ow-zoom-tool"].fire("click");
  s.canvas.fire("pointerdown", s.pt(400, 300));
  s.canvas.fire("pointerup", s.pt(400, 300));
  var box = s.els["#ow-select-box"];
  assert.strictEqual(box.hidden, false);
  assert.strictEqual(parseFloat(box.style.width), 100, "a quarter of the 400px shown width");
  assert.strictEqual(parseFloat(box.style.left), 1 + 150, "centred: (400/800 - 0.125) * 400 + the border");
  assert.ok(/Zoom 4x/.test(s.els["#ow-zoom-status"].textContent));
  assert.strictEqual(s.els["#ow-zoom-go"].disabled, false);
});

test("a drag sizes the box, switches the zoom list to custom, and warns when it is deeper than the map recorded", function () {
  var s = setup();
  s.els["#ow-zoom-tool"].fire("click");
  s.canvas.fire("pointerdown", s.pt(100, 100));
  s.canvas.fire("pointermove", s.pt(180, 160));
  s.canvas.fire("pointermove", s.pt(180 + 14, 160));
  s.canvas.fire("pointerup", s.pt(194, 160));
  assert.strictEqual(s.els["#ow-zoom-level"].value, "custom");
  // dragged 94 canvas pixels across an 800 pixel map: 800 / 94 = 8.5x
  assert.ok(/Zoom 8\.5x/.test(s.els["#ow-zoom-status"].textContent), s.els["#ow-zoom-status"].textContent);
  assert.ok(/added texture/.test(s.els["#ow-zoom-status"].textContent), "deep zoom warning");
});

test("the page's own click handler does not also fire while a box is being placed", function () {
  var s = setup();
  var pageClicked = 0;
  s.canvas.addEventListener("click", function () { pageClicked++; });
  s.canvas.fire("click");
  assert.strictEqual(pageClicked, 1, "tool off: the page's click goes through");
  s.els["#ow-zoom-tool"].fire("click");
  s.canvas.fire("click");
  assert.strictEqual(pageClicked, 1, "tool on: the click is swallowed");
});

test("changing the zoom list resizes the box around the same centre", function () {
  var s = setup();
  s.els["#ow-zoom-tool"].fire("click");
  s.canvas.fire("pointerdown", s.pt(400, 300));
  s.canvas.fire("pointerup", s.pt(400, 300));
  s.els["#ow-zoom-level"].value = "2";
  s.els["#ow-zoom-level"].fire("change");
  assert.strictEqual(parseFloat(s.els["#ow-select-box"].style.width), 200);
  assert.strictEqual(parseFloat(s.els["#ow-select-box"].style.left), 1 + 100, "still centred");
});

test("the keyboard moves, zooms, opens and cancels", function () {
  var s = setup();
  s.els["#ow-zoom-tool"].fire("click");
  s.canvas.fire("keydown", { key: "ArrowRight" });
  var first = parseFloat(s.els["#ow-select-box"].style.left);
  s.canvas.fire("keydown", { key: "ArrowRight" });
  assert.ok(parseFloat(s.els["#ow-select-box"].style.left) > first, "moved right");
  s.canvas.fire("keydown", { key: "+" });
  assert.ok(parseFloat(s.els["#ow-select-box"].style.width) < 100, "zoomed in, so a smaller box");
  s.canvas.fire("keydown", { key: "Enter" });
  assert.strictEqual(s.opened.length, 1);
  assert.ok(s.opened[0].ww < 0.25 && s.opened[0].seed === 7, "opens with the map's own settings and the box");
  s.canvas.fire("keydown", { key: "Escape" });
  assert.strictEqual(s.els["#ow-select-box"].hidden, true);
  assert.strictEqual(s.wrap.classes.selecting, false);
});

test("the Open button hands the box and the settings to the page", function () {
  var s = setup();
  s.els["#ow-zoom-tool"].fire("click");
  s.canvas.fire("pointerdown", s.pt(0, 0));
  s.canvas.fire("pointerup", s.pt(0, 0));
  s.els["#ow-zoom-go"].fire("click");
  assert.strictEqual(s.opened.length, 1);
  assert.deepStrictEqual({ wx: s.opened[0].wx, wy: s.opened[0].wy, ww: s.opened[0].ww }, { wx: 0, wy: 0, ww: 0.25 }, "pushed inside the map at the corner");
  assert.strictEqual(s.opened[0].cells, 40000);
});

test("starting over (a different map) clears the box; showing one does not turn the tool on", function () {
  var s = setup();
  s.tool.show({ wx: 0.25, wy: 0.25, ww: 0.25 });
  assert.strictEqual(s.els["#ow-select-box"].hidden, false);
  assert.strictEqual(s.tool.isActive(), false);
  s.tool.reset();
  assert.strictEqual(s.els["#ow-select-box"].hidden, true);
  assert.strictEqual(s.els["#ow-zoom-go"].disabled, true);
});

test("with no map drawn yet there is nothing to open", function () {
  var s = setup(null);
  s.els["#ow-zoom-tool"].fire("click");
  s.canvas.fire("pointerdown", s.pt(400, 300));
  s.canvas.fire("pointerup", s.pt(400, 300));
  assert.strictEqual(s.els["#ow-zoom-go"].disabled, true);
  s.canvas.fire("keydown", { key: "Enter" });
  assert.strictEqual(s.opened.length, 0);
});

console.log("\n" + passed + " passed");
