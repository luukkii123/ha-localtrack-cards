"use strict";

// #1304 M21, follow-up to the M6 measurement: the version banner is not
// logged from the bundle's top level. DevTools and Playwright capture a stack
// trace for every console call; from the top level that makes V8 re-parse
// the whole 300 kB top-level function (with the 147 kB Leaflet inside) for
// its source positions, inside the module evaluation. The banner follows in
// a task of its own.
const test = require("node:test");
const assert = require("node:assert/strict");
const { ladeKarte } = require("./laden.js");

test("the version banner is logged once, in a task after the bundle's evaluation", async () => {
  const { kontext, CARD_VERSION } = ladeKarte(["CARD_VERSION"]);
  const calls = [];
  kontext.console = { ...kontext.console, info: (...args) => calls.push(args) };
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(calls.length, 1, "banner not logged after loading, or logged from the top level");
  assert.match(calls[0][0], new RegExp(`LOCALTRACK-CARDS %c v${CARD_VERSION.replace(/\./g, "\\.")}`));
  assert.equal(calls[0].length, 3, "banner styles");
});
