// Security audit 2026-10-08 (R2, R3): saved images are loaded with the login
// cookie, and the map key's labels are escaped.
//
//   node test/images.test.js
//
// Plain Node, standard library only, like the other tests here.

var assert = require("assert");
var fs = require("fs");
var path = require("path");
var root = path.join(__dirname, "..");
var wikilink = fs.readFileSync(path.join(root, "lib", "wikilink.js"), "utf8");
var legend = fs.readFileSync(path.join(root, "lib", "keyed-legend.js"), "utf8");

var passed = 0;
function test(name, fn) { fn(); passed++; console.log("ok - " + name); }

test("embedded note images send the cookie and the Origin header (crossOrigin before src)", function () {
  var cors = wikilink.indexOf("img.crossOrigin = 'use-credentials'");
  var src = wikilink.indexOf("img.src = ");
  assert.ok(cors !== -1, "use-credentials is set");
  assert.ok(src !== -1 && cors < src, "and it is set before src, or the request has already gone out");
  assert.ok(!/crossOrigin = 'anonymous'/.test(wikilink), "anonymous would drop the cookie");
});

test("the map key escapes its labels, numbers and heading", function () {
  // Pull the function out and run it against a hostile entry.
  var fn = new Function(legend + "\nreturn renderKeyLegendPanel;")();
  var el = { innerHTML: "" };
  var container = { querySelector: function () { return el; } };
  fn(container, "#k", "<b>Heading</b>", [{ number: "<i>1</i>", label: '<img src=x onerror=alert(1)> & "q"' }]);
  assert.ok(el.innerHTML.indexOf("<img") === -1, "no raw tag survives");
  assert.ok(el.innerHTML.indexOf("<b>") === -1 && el.innerHTML.indexOf("<i>") === -1);
  assert.ok(el.innerHTML.indexOf("&lt;img src=x onerror=alert(1)&gt; &amp; &quot;q&quot;") !== -1);
  assert.ok(el.innerHTML.indexOf('<p class="key-room">') !== -1, "the markup this file builds is still markup");
});

test("an empty key clears the panel", function () {
  var fn = new Function(legend + "\nreturn renderKeyLegendPanel;")();
  var el = { innerHTML: "old" };
  fn({ querySelector: function () { return el; } }, "#k", "H", []);
  assert.strictEqual(el.innerHTML, "");
});

test("the page's CSP still allows images from the API (and nothing else new)", function () {
  var html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  assert.ok(/img-src 'self' https:\/\/api\.barnyard\.site;/.test(html));
});

console.log("\n" + passed + " tests passed");
