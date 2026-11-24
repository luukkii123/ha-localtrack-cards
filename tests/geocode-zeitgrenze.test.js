"use strict";

// #1304 M34 rest (with M54): reverseGeocode gets a time limit. A Nominatim
// that never answers is aborted after 8 s (AbortController), blocks neither
// the stay list nor later lookups and loads, and does not cause a retry
// storm: after a failure lookups pause for 60 s and answer "" at once.
const test = require("node:test");
const assert = require("node:assert/strict");
const { createClock } = require("./_testkit.cjs");
const { ladeKarte, feuere, einhaengen, ruhe } = require("./laden.js");

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

const NOW = 1_800_000_000;

/** Two stays of 15 min outside every zone, on the day of `start`. */
function points(msg) {
  const base = Date.parse(msg.start) / 1000 + 6 * 3600;
  const out = [];
  for (let t = 0; t <= 900; t += 60) out.push({ lat: 50.05, lon: 8.05, ts: base + t });
  for (let t = 1800; t <= 2700; t += 60) out.push({ lat: 50.1, lon: 8.1, ts: base + t });
  return out;
}

async function settle(clock) {
  for (let i = 0; i < 5; i += 1) { await clock.advance(0); await ruhe(); }
}

/** A card whose Nominatim hangs until `nominatim.mode` says otherwise. */
function karte() {
  const clock = createClock(NOW * 1000);
  const k = ladeKarte(["LocaltrackTimelineCard"]);
  Object.assign(k.kontext, {
    setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout, Date: clock.Date,
    ResizeObserver: class { observe() {} disconnect() {} }, AbortController,
  });
  k.kontext.L = leaflet();
  const nominatim = { mode: "hang", calls: [], aborted: 0 };
  k.kontext.fetch = (url, options = {}) => {
    nominatim.calls.push(url);
    if (nominatim.mode === "ok") {
      return Promise.resolve({ json: () => Promise.resolve({ address: { road: "Hauptstraße" } }) });
    }
    return new Promise((_, reject) => {
      options.signal?.addEventListener("abort", () => {
        nominatim.aborted += 1;
        reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
      });
    });
  };
  const ws = [];
  const card = new k.LocaltrackTimelineCard();
  einhaengen(card);
  card.setConfig({ entity: "person.a", reverse_geocode: true });
  card.hass = { states: { "person.a": { attributes: {} } }, entities: {}, locale: { language: "en" },
    callWS: (msg) => { ws.push(msg); return Promise.resolve({ points: points(msg), simplified: false }); } };
  const labels = () => card._segmentsEl.children.filter((r) => r.className.includes("stay"))
    .map((r) => r.querySelector(".label").textContent).join("|");
  return { k, card, clock, nominatim, ws, labels };
}

test("hanging Nominatim: list at once, request aborted after 8 s, no retry storm", async () => {
  const { card, clock, nominatim, labels } = karte();
  await settle(clock);
  assert.equal(labels(), "Stay|Stay", "list does not wait for Nominatim");
  assert.equal(nominatim.calls.length, 1);
  await clock.advance(7999);
  assert.equal(nominatim.aborted, 0, "still waiting before 8 s");
  await clock.advance(1);
  await settle(clock);
  assert.equal(nominatim.aborted, 1, "aborted after 8 s");
  assert.equal(nominatim.calls.length, 1, "the queued second lookup pauses instead of asking again");
  assert.equal(labels(), "Stay|Stay");
  // Re-rendering during the pause asks nothing.
  card._renderSegments();
  await settle(clock);
  assert.equal(nominatim.calls.length, 1, "no request during the 60 s pause");
  assert.equal(clock.pending() <= 2, true, "no timers piling up");
});

test("hanging Nominatim blocks neither later loads nor later lookups", async () => {
  const { card, clock, nominatim, ws, labels } = karte();
  await settle(clock);
  // A day change while the lookup hangs: the load runs at once.
  card._dateEl.value = "2027-01-14";
  feuere(card._dateEl, "change");
  await settle(clock);
  assert.equal(ws.length, 2, "the next day loads although Nominatim hangs");
  assert.equal(labels(), "Stay|Stay", "its list is there");
  assert.equal(card._overlayEl.textContent, "");
  // After the limit and the pause Nominatim is back: one request per row.
  await clock.advance(8000);
  await settle(clock);
  await clock.advance(60000);
  nominatim.mode = "ok";
  const before = nominatim.calls.length;
  card._dateEl.value = "2027-01-13";
  feuere(card._dateEl, "change");
  await settle(clock);
  assert.equal(nominatim.calls.length - before, 2, "one lookup per stay, nothing repeated");
  assert.equal(labels(), "Hauptstraße|Hauptstraße");
});
