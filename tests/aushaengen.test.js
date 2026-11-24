"use strict";

// #1304 M52 (Buschcheck P14): a timeline card that Home Assistant throws away
// (dashboard edit, card picker) frees its Leaflet map. Leaflet hangs a resize
// listener on window that would keep map, shadow DOM and points alive. The
// check runs one tick later, so a card that is only moved keeps its map;
// hanging it in again builds a new one.
const test = require("node:test");
const assert = require("node:assert/strict");
const { createClock } = require("./_testkit.cjs");
const { ladeKarte, einhaengen, ruhe } = require("./laden.js");

/** Stand-in Leaflet whose maps count `remove()` calls. */
function leaflet() {
  const maps = [];
  const layer = () => ({ addTo() { return this; }, clearLayers() {}, setLatLng() { return this; } });
  return {
    maps,
    Icon: { Default: { mergeOptions() {} } },
    map(el) {
      const m = { el, removed: 0, remove() { this.removed += 1; }, setView() {}, removeLayer() {},
        invalidateSize() {}, fitBounds() {}, panTo() {}, getBounds: () => ({ contains: () => true }) };
      maps.push(m);
      return m;
    },
    tileLayer: layer, layerGroup: layer, polyline: layer, circleMarker: layer, marker: layer,
    divIcon: () => ({}), latLngBounds: () => ({ pad() { return this; } }),
  };
}

/** A card with a built map, its timers on the kit clock. */
async function karte() {
  const clock = createClock();
  const k = ladeKarte(["LocaltrackTimelineCard"]);
  Object.assign(k.kontext, { setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout, Date: clock.Date,
    ResizeObserver: class { observe() {} disconnect() {} } });
  const L = leaflet();
  k.kontext.L = L;
  const card = new k.LocaltrackTimelineCard();
  einhaengen(card);
  card.setConfig({ entity: "person.a" });
  card.hass = { states: { "person.a": { attributes: {} } }, locale: { language: "en" },
    callWS: () => Promise.resolve({ points: [] }) };
  await clock.advance(0);
  await ruhe();
  assert.equal(L.maps.length, 1, "map built");
  return { card, clock, L };
}

const styles = (card) => card.shadowRoot.childNodes.filter((n) => n.tagName === "STYLE").length;

test("unhooked and not hooked in again: map.remove() exactly once, state reset", async () => {
  const { card, clock, L } = await karte();
  card.remove();
  assert.equal(L.maps[0].removed, 0, "removed in the same tick");
  await clock.advance(0);
  assert.equal(L.maps[0].removed, 1);
  assert.equal(card._map, null);
  assert.equal(card._markerLayer, null);
  assert.equal(card._polyline, null);
  assert.equal(card._needsLoad, true);
  await clock.advance(1000);
  assert.equal(L.maps[0].removed, 1, "removed twice");
});

test("moved within one tick: the map stays", async () => {
  const { card, clock, L } = await karte();
  card.remove();
  einhaengen(card);
  await clock.advance(0);
  assert.equal(L.maps[0].removed, 0);
  assert.equal(card._map, L.maps[0]);
});

test("hung in again after the release: a new map, one Leaflet stylesheet", async () => {
  const { card, clock, L } = await karte();
  const before = styles(card);
  card.remove();
  await clock.advance(0);
  einhaengen(card);
  await clock.advance(0);
  await ruhe();
  assert.equal(L.maps.length, 2, "no new map after hanging in again");
  assert.equal(card._map, L.maps[1]);
  assert.equal(styles(card), before, "Leaflet stylesheet added twice");
});

test("a new config builds new elements and frees the old map", async () => {
  const { card, clock, L } = await karte();
  card.setConfig({ entity: "person.a", height: 400 });
  await clock.advance(0);
  await ruhe();
  assert.equal(L.maps[0].removed, 1, "old map on the discarded element not freed");
  assert.equal(L.maps.length, 2);
  assert.equal(L.maps[1].el, card._mapEl, "new map not on the new element");
});
