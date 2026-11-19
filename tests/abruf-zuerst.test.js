"use strict";

// #1304 M54, follow-up to the M6 measurement: the first `hass` sends the
// history request at once. Leaflet is evaluated and the map is built only
// after the answer has been turned into the stay list, so the WebSocket
// answer never waits behind the ~24 ms Leaflet evaluation and the list is
// drawn before the map.
const test = require("node:test");
const assert = require("node:assert/strict");
const { ladeKarte, ruhe, offen } = require("./laden.js");

/** Stand-in Leaflet that writes every map-side step into `order`. */
function leaflet(order) {
  const layer = (name) => () => {
    if (name) order.push(name);
    return { addTo() { return this; }, setLatLng() { return this; }, clearLayers() {}, removeLayer() {}, addLatLng() {} };
  };
  return {
    Icon: { Default: { mergeOptions() {} } },
    map: () => {
      order.push("map");
      return { remove() {}, setView() {}, removeLayer() {}, invalidateSize() {}, fitBounds() {}, panTo() {},
        getBounds: () => ({ contains: () => true }) };
    },
    tileLayer: layer(), layerGroup: layer(), polyline: layer("track"), circleMarker: layer(), marker: layer(),
    divIcon: (options) => options, latLngBounds: () => ({ pad() { return this; } }),
  };
}

/** Two stays of 15 min, back to back. */
function points() {
  const out = [];
  const stay = (from, lat, lon) => { for (let t = 0; t <= 900; t += 60) out.push({ lat, lon, ts: 1_800_000_000 + from + t }); };
  stay(0, 50, 8);
  stay(1800, 50.05, 8.05);
  return out;
}

async function settle() {
  for (let i = 0; i < 5; i += 1) await ruhe();
}

/** A connected timeline whose Leaflet access, requests and list rows are
 *  recorded in one `order` list. */
function karte() {
  const k = ladeKarte(["LocaltrackTimelineCard"]);
  const order = [];
  const fake = leaflet(order);
  Object.defineProperty(k.kontext, "L", {
    configurable: true,
    get() { order.push("leaflet"); return fake; },
  });
  k.kontext.ResizeObserver = class { observe() {} disconnect() {} };
  const antwort = offen();
  const card = new k.LocaltrackTimelineCard();
  card.isConnected = true;
  card.setConfig({ entity: "person.a" });
  const list = card._segmentsEl;
  const insert = list.insertBefore.bind(list);
  list.insertBefore = (node, ref) => {
    if (!order.includes("list")) order.push("list");
    return insert(node, ref);
  };
  const hass = {
    states: { "person.a": { attributes: { friendly_name: "A" } } },
    entities: {},
    locale: { language: "en" },
    callWS: (msg) => { order.push(`ws:${msg.type}`); return antwort.promise; },
  };
  return { card, hass, order, antwort };
}

test("the first hass sends the history request before Leaflet is evaluated", async () => {
  const { card, hass, order, antwort } = karte();
  card.hass = hass;
  assert.deepEqual(order, ["ws:localtrack/history"], "request not sent synchronously with the first hass");
  await settle();
  assert.ok(!order.includes("leaflet"), `Leaflet evaluated while the answer is in flight: ${order.join(" > ")}`);
  antwort.resolve({ points: points(), total: 32, simplified: false });
  await settle();
  assert.ok(order.includes("leaflet") && order.includes("map"), `map not built after the answer: ${order.join(" > ")}`);
});

test("the stay list is drawn before the map is built and the track drawn", async () => {
  const { card, hass, order, antwort } = karte();
  card.hass = hass;
  antwort.resolve({ points: points(), total: 32, simplified: false });
  await settle();
  const at = (name) => order.indexOf(name);
  assert.ok(at("list") >= 0 && at("map") >= 0 && at("track") >= 0, order.join(" > "));
  assert.ok(at("list") < at("leaflet"), `list after Leaflet: ${order.join(" > ")}`);
  assert.ok(at("list") < at("map") && at("map") < at("track"), order.join(" > "));
  assert.equal(card._overlayEl.textContent, "", "loading finished");
  assert.equal(card._segmentsEl.children.length, 2, "two stays");
});

test("a failed first request still shows its error, without a map", async () => {
  const { card, hass, order, antwort } = karte();
  card.hass = hass;
  antwort.reject(Object.assign(new Error("boom"), { code: "unknown_error" }));
  await settle();
  assert.notEqual(card._overlayEl.textContent, "", "error not shown");
  assert.notEqual(card._overlayEl.textContent, card._t.laden, "still loading");
  assert.equal(card._loading, false);
});
