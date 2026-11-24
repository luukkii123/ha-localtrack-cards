"use strict";

// #1304 M54 (Buschcheck P16): with `reverse_geocode` the stay list does not
// wait for Nominatim. It appears at once with zone names (or "Stay"); place
// names are filled into their row afterwards, without rebuilding the list,
// so focus stays where it is. Zones are filtered once instead of scanning
// all of hass.states for every point and every scrubber step.
const test = require("node:test");
const assert = require("node:assert/strict");
const { ladeKarte, feuere, einhaengen, ruhe, offen } = require("./laden.js");

function leaflet() {
  const layer = () => ({ addTo() { return this; }, setLatLng() { return this; }, clearLayers() {}, removeLayer() {} });
  return {
    Icon: { Default: { mergeOptions() {} } },
    map: () => ({ remove() {}, setView() {}, removeLayer() {}, invalidateSize() {}, fitBounds() {}, panTo() {},
      getBounds: () => ({ contains: () => true }) }),
    tileLayer: layer, layerGroup: layer, polyline: layer, circleMarker: layer, marker: layer,
    divIcon: (options) => options, latLngBounds: () => ({ pad() { return this; } }),
  };
}

/** Three stays of 15 min: inside zone.work, outside every zone, outside again. */
function points() {
  const out = [];
  const stay = (from, lat, lon) => { for (let t = 0; t <= 900; t += 60) out.push({ lat, lon, ts: 1_800_000_000 + from + t }); };
  stay(0, 50, 8);
  stay(1800, 50.05, 8.05);
  stay(3600, 50.1, 8.1);
  return out;
}

async function settle() {
  for (let i = 0; i < 5; i += 1) await ruhe();
}

/** hass.states as a proxy that counts key enumerations. */
function gezaehlt(states, zaehler) {
  return new Proxy(states, { ownKeys(target) { zaehler.scans += 1; return Reflect.ownKeys(target); } });
}

function karte({ fetch, states: extra = {} } = {}) {
  const k = ladeKarte(["LocaltrackTimelineCard"]);
  k.kontext.L = leaflet();
  k.kontext.ResizeObserver = class { observe() {} disconnect() {} };
  const anfragen = [];
  k.kontext.fetch = (url, options) => { anfragen.push(url); return fetch(url, options); };
  const zaehler = { scans: 0 };
  const states = gezaehlt({
    "person.a": { attributes: { friendly_name: "A" } },
    "zone.work": { attributes: { friendly_name: "Work", latitude: 50, longitude: 8, radius: 50 } },
    "zone.far": { attributes: { friendly_name: "Far", latitude: 10, longitude: 10, radius: 50 } },
    ...extra,
  }, zaehler);
  const card = new k.LocaltrackTimelineCard();
  einhaengen(card);
  card.setConfig({ entity: "person.a", reverse_geocode: true });
  card.hass = { states, entities: {}, locale: { language: "en" },
    callWS: () => Promise.resolve({ points: points(), total: 48, simplified: false }) };
  return { k, card, anfragen, zaehler };
}

const labels = (card) => card._segmentsEl.children.filter((r) => r.className.includes("stay"))
  .map((r) => r.querySelector(".label").textContent);

test("the list appears at once with zone names while Nominatim has not answered", async () => {
  const pending = [];
  const { card, anfragen } = karte({ fetch: () => { const o = offen(); pending.push(o); return o.promise; } });
  await settle();
  assert.deepEqual(labels(card).join("|"), "Work|Stay|Stay", "list without waiting");
  assert.equal(card._overlayEl.textContent, "", "loading finished");
  assert.equal(anfragen.length, 1, "Nominatim asked one after the other");
  assert.ok(!anfragen.some((u) => u.includes("lat=50&")), "a stay in a zone is not geocoded");
});

test("place names are filled into their rows without rebuilding the list; focus stays", async () => {
  const pending = [];
  const { card } = karte({ fetch: () => { const o = offen(); pending.push(o); return o.promise; } });
  await settle();
  const list = card._segmentsEl;
  const rows = list.children.slice();
  const target = rows.find((r) => r.querySelector(".label").textContent === "Stay");
  target.focus();                                  // the user tabbed to this row
  const writes = [];
  for (const method of ["insertBefore", "appendChild", "replaceChildren"]) {
    const original = list[method].bind(list);
    list[method] = (...args) => { writes.push(method); return original(...args); };
  }
  pending.shift().resolve({ json: () => Promise.resolve({ address: { road: "Hauptstraße" } }) });
  await settle();
  pending.shift().resolve({ json: () => Promise.resolve({ address: { suburb: "Nordend" } }) });
  await settle();
  assert.equal(labels(card).join("|"), "Work|Hauptstraße|Nordend");
  assert.deepEqual(writes, [], "no row inserted or replaced");
  assert.ok(rows.every((r, i) => list.children[i] === r), "same row nodes in the same order");
  assert.equal(card.shadowRoot.activeElement, target, "focus stays on its row");
  assert.equal(target.querySelector(".label").textContent, "Hauptstraße");
});

test("a late place name for a row that is gone is dropped", async () => {
  const pending = [];
  const { card } = karte({ fetch: () => { const o = offen(); pending.push(o); return o.promise; } });
  await settle();
  card._segments = [];
  card._renderSegments();
  pending.shift().resolve({ json: () => Promise.resolve({ address: { road: "Alt" } }) });
  await settle();
  assert.equal(card._segmentsEl.childElementCount, 0);
});

test("zones are filtered once: scrubbing does not scan hass.states", async () => {
  const many = {};
  for (let i = 0; i < 3000; i += 1) many[`sensor.s${i}`] = { state: String(i), attributes: {} };
  const { card, zaehler } = karte({ fetch: () => Promise.resolve({ json: () => Promise.resolve({}) }), states: many });
  await settle();
  const afterLoad = zaehler.scans;
  assert.ok(afterLoad <= 1, `load scanned hass.states ${afterLoad} times`);
  for (let i = 0; i < 48; i += 1) {
    card._scrubberEl.value = String(i);
    feuere(card._scrubberEl, "input");
  }
  assert.equal(zaehler.scans, afterLoad, "no scan per scrubber step");
  assert.match(card._scrubLabelEl.textContent, /· (Work|on the move)$/);
});
