"use strict";

// #1304 M21 (Buschcheck P6): the embedded Leaflet UMD is evaluated on first
// use (the first _ensureMap), not when the bundle loads. A Leaflet that is
// already on the page (busch-cards) is reused, so both cards share one
// instance whatever order the bundles load in.
const test = require("node:test");
const assert = require("node:assert/strict");
const { ladeKarte, einhaengen } = require("./laden.js");

/** A stand-in Leaflet that records the maps made with it. */
function fremdesLeaflet() {
  const maps = [];
  const layer = () => ({ addTo() { return this; } });
  return {
    maps,
    version: "fremd",
    Icon: { Default: { mergeOptions() {} } },
    map(el) { const m = { el, remove() {} }; maps.push(m); return m; },
    tileLayer: layer,
  };
}

function timeline(k) {
  const card = new k.LocaltrackTimelineCard();
  einhaengen(card);
  card.setConfig({ entity: "person.a" });
  return card;
}

test("loading the bundle does not evaluate Leaflet", () => {
  const { kontext } = ladeKarte(["CARD_VERSION"]);
  assert.equal(kontext.L, undefined, "window.L set while loading");
  assert.equal(kontext.leaflet, undefined, "UMD ran while loading");
});

test("first use evaluates the embedded Leaflet once and sets window.L", () => {
  const k = ladeKarte(["localtrackLeaflet"]);
  const first = k.localtrackLeaflet();
  assert.equal(first.version, "1.9.4");
  assert.equal(k.kontext.L, first);
  assert.equal(k.localtrackLeaflet(), first, "second call evaluates again");
});

test("a Leaflet already on the page is reused, window.L stays untouched", () => {
  const k = ladeKarte(["localtrackLeaflet"]);
  const fremd = fremdesLeaflet();
  k.kontext.L = fremd;
  assert.equal(k.localtrackLeaflet(), fremd);
  assert.equal(k.kontext.L, fremd);
  assert.equal(k.kontext.leaflet, undefined, "embedded UMD ran although window.L existed");
});

test("two timeline cards on one page share one Leaflet instance", async () => {
  const k = ladeKarte(["LocaltrackTimelineCard"]);
  const fremd = fremdesLeaflet();
  k.kontext.L = fremd;
  const a = timeline(k);
  const b = timeline(k);
  await a._ensureMap();
  await b._ensureMap();
  assert.equal(a._leaflet, fremd);
  assert.equal(b._leaflet, fremd);
  assert.equal(fremd.maps.length, 2);
  assert.equal(k.kontext.leaflet, undefined);
});
