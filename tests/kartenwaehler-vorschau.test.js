"use strict";

// #1304 M53 (Buschcheck P15, decision E11): in Home Assistant's card picker
// both Local Track cards show a static preview with sample data and make no
// WebSocket, tile or Nominatim request. The picker places each preview in a
// `div.preview` inside the shadow root of `hui-card-picker`, so the check
// walks up across shadow boundaries. The same card on a dashboard still loads.
// Clock and hass with request counters come from the shared test kit, the DOM
// from laden.js (it parses the cards' skeleton markup); counters prove "0".
const test = require("node:test");
const assert = require("node:assert/strict");
const { createClock, createHass } = require("./_testkit.cjs");
const { ladeKarte, FakeElement } = require("./laden.js");

function umgebung() {
  const clock = createClock();
  const fetches = [];
  const k = ladeKarte(["LocaltrackTimelineCard", "LocaltrackZoneTimeCard", "TEXTE_LOCALTRACK_TIMELINE_CARD"],
    { sprache: "de-DE" });
  Object.assign(k.kontext, {
    setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout, Date: clock.Date,
    fetch: (url) => { fetches.push(String(url)); return new Promise(() => {}); },
    ResizeObserver: class { observe() {} disconnect() {} },
  });
  const ha = createHass({
    clock,
    language: "de",
    states: {
      "person.a": { state: "home", attributes: { friendly_name: "Anna" } },
      "zone.home": { state: "1", attributes: { friendly_name: "Zuhause", latitude: 50, longitude: 8, radius: 100 } },
      "zone.work": { state: "0", attributes: { friendly_name: "Büro", latitude: 50.1, longitude: 8.1, radius: 50 } },
    },
  });
  ha.respond("localtrack/history", { points: [] });
  ha.respond("localtrack/stats", { tracked: ["person.a"] });
  ha.respond("localtrack/zone_time", { days: [], days_present: 0, total_net_s: 0, total_gross_s: 0, total_visits: 0 });
  const klassen = { "localtrack-timeline-card": k.LocaltrackTimelineCard, "localtrack-zone-time-card": k.LocaltrackZoneTimeCard };
  return { k, clock, ha, fetches, klassen };
}

/** Like hui-card-picker: create, setConfig with the stub, hass, then attach
 *  into `div.preview` inside the picker's shadow root. */
function imWaehler(u, type) {
  const picker = new FakeElement("hui-card-picker");
  const shadow = new FakeElement("#shadow-root");
  shadow.host = picker;               // as in the browser: the root knows its host
  const preview = new FakeElement("div");
  preview.className = "preview";
  shadow.appendChild(preview);
  const Klasse = u.klassen[type];
  const card = new Klasse();
  card.isConnected = false;
  card.setConfig(Klasse.getStubConfig(u.ha.hass));
  card.hass = u.ha.hass;
  preview.appendChild(card);
  card.isConnected = true;
  card.connectedCallback();
  return card;
}

const anfragen = (ha) => Object.values(ha.stats.count).reduce((a, b) => a + b, 0);

test("card picker: timeline shows a static sample day without any request", async () => {
  const u = umgebung();
  const card = imWaehler(u, "localtrack-timeline-card");
  await u.clock.advance(0);
  // A state change of the person later on must not start a live refresh either.
  u.ha.patchState("person.a", { state: "not_home" });
  card.hass = u.ha.hass;
  await u.clock.advance(120000);
  assert.equal(anfragen(u.ha), 0, "WebSocket calls in the picker");
  assert.deepEqual(u.fetches, [], "fetch (Nominatim) in the picker");
  assert.equal(u.k.kontext.L, undefined, "Leaflet evaluated, tiles possible");
  assert.equal(card._map, null);
  const rows = card._segmentsEl.querySelectorAll(".segment");
  assert.ok(rows.length >= 3, "sample stays and trips listed");
  const words = u.k.TEXTE_LOCALTRACK_TIMELINE_CARD.de.texte;
  assert.ok(rows.some((r) => r.textContent.includes(words.vorschau_zuhause)), "sample stay named from the dictionary");
  assert.equal(card._titleEl.textContent, "Anna");
  assert.equal(card._mapEl.getAttribute("aria-label"), words.vorschau_karte);
});

test("card picker: zone time shows a static sample month without any request", async () => {
  const u = umgebung();
  const card = imWaehler(u, "localtrack-zone-time-card");
  await u.clock.advance(120000);
  assert.equal(anfragen(u.ha), 0, "WebSocket calls in the picker");
  assert.deepEqual(u.fetches, []);
  assert.equal(card._tableEl.hidden, false, "sample table hidden");
  assert.ok((card._bodyEl.innerHTML.match(/<tr/g) || []).length >= 28, "one row per day");
  assert.ok(/\d+:\d\d/.test(card._footEl.innerHTML), "sample totals");
  assert.equal(card._titleEl.textContent, "Büro");
});

test("on a dashboard both cards still load, once they are attached", async () => {
  const u = umgebung();
  const layer = () => ({ addTo() { return this; }, clearLayers() {} });
  u.k.kontext.L = { Icon: { Default: { mergeOptions() {} } }, tileLayer: layer, layerGroup: layer,
    map: () => ({ setView() {}, removeLayer() {}, invalidateSize() {} }) };
  for (const type of ["localtrack-timeline-card", "localtrack-zone-time-card"]) {
    const card = new u.klassen[type]();
    card.isConnected = false;
    const vorher = anfragen(u.ha);
    card.setConfig(u.klassen[type].getStubConfig(u.ha.hass));
    card.hass = u.ha.hass;
    await u.clock.advance(0);
    assert.equal(anfragen(u.ha), vorher, `${type} fetched before being attached`);
    new FakeElement("div").appendChild(card);
    card.isConnected = true;
    card.connectedCallback();
    await u.clock.advance(0);
  }
  assert.equal(u.ha.count("localtrack/history"), 1);
  assert.equal(u.ha.count("localtrack/zone_time"), 1);
});
