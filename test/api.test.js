// The Campaign front end's API calls must send the login cookie on reads as well
// as writes: the Worker picks a signed-in guest's own campaign space from the
// session, so an uncredentialed read would show them the shared space instead.
//
//   node test/api.test.js
//
// Plain Node, standard library only, like the other tests here.

var assert = require("assert");
var fs = require("fs");
var path = require("path");
var src = fs.readFileSync(path.join(__dirname, "..", "lib", "api.js"), "utf8");

var passed = 0;
function test(name, fn) { fn(); passed++; console.log("ok - " + name); }

test("Api.get sends credentials", function () {
  assert.ok(/async get\(path\) \{[\s\S]*?fetch\(API_BASE \+ path, \{ credentials: 'include' \}\)/.test(src));
});

test("Api.post still sends credentials", function () {
  assert.ok(/async post\(path, body\) \{[\s\S]*?credentials: 'include'/.test(src));
});

test("every fetch in lib/api.js is credentialed (none can slip back to anonymous)", function () {
  var calls = src.split("fetch(API_BASE").length - 1;
  var credentialed = (src.match(/credentials: 'include'/g) || []).length;
  assert.ok(calls >= 2, "both calls are there");
  assert.ok(credentialed >= calls, "each has credentials: " + credentialed + " of " + calls);
});

console.log("\n" + passed + " tests passed");
