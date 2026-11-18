"use strict";

// #1287 M34 (Buschcheck N9): a localtrack call that never answers must not
// hold the load lock forever. After 15 s the card shows the timeout error,
// the lock is free and the next refresh loads again. Virtual time and the
// hang come from the shared test kit (M5).
const test = require("node:test");
const assert = require("node:assert/strict");
const { createClock, createHass } = require("./_testkit.cjs");
const { ladeKarte } = require("./laden.js");

/** Loads the bundle with the kit clock as the sandbox's timers and Date. */
function laden(namen) {
  const clock = createClock();
  const k = ladeKarte(namen);
  Object.assign(k.kontext, {
    setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout, Date: clock.Date,
  });
  return { k, clock };
}

function leaflet() {
  const layer = () => ({ addTo() { return this; }, setLatLng() { return this; }, clearLayers() {} });
  return {
    layerGroup: layer, polyline: layer, circleMarker: layer,
    divIcon: (options) => ({ options }), marker: layer,
    latLngBounds: () => ({ pad() { return this; } }),
  };
}

const MAP = {
  removeLayer() {}, setView() {}, fitBounds() {}, invalidateSize() {}, panTo() {},
  getBounds: () => ({ contains: () => true }),
};

/** One stay of 15 minutes. */
function points(start) {
  const out = [];
  for (let t = 0; t <= 900; t += 60) out.push({ lat: 50, lon: 8, ts: start + t });
  return out;
}

test("timeline: hung day fetch → timeout error after 15 s, lock free, next refresh shows data", async () => {
  const { k, clock } = laden(["LocaltrackTimelineCard", "TEXTE_LOCALTRACK_TIMELINE_CARD"]);
  const texte = k.TEXTE_LOCALTRACK_TIMELINE_CARD.en.texte;
  const ha = createHass({ clock, states: { "person.a": { state: "away", attributes: { friendly_name: "A" } } } });
  ha.respond("localtrack/history", () => ({ points: points(Math.floor(clock.now / 1000)) }));
  ha.behaveOnce("localtrack/history", { hang: true });

  const card = new k.LocaltrackTimelineCard();
  card._leaflet = leaflet();
  card._map = MAP;
  card.setConfig({ entity: "person.a" });
  card.hass = ha.hass;
  await clock.advance(0);
  assert.equal(ha.count("localtrack/history"), 1);
  assert.equal(ha.held("localtrack/history"), 1, "the first day fetch hangs");

  await clock.advance(14999);
  assert.equal(card._loading, true, "still waiting before 15 s");

  await clock.advance(1);
  assert.equal(card._loading, false, "lock released after 15 s");
  assert.equal(card._overlayEl.textContent, texte.zeitueberschreitung);
  assert.equal(card._overlayEl.style.display, "");

  // The tracker moves: the 30 s refresh timer is the next tick. Only a new
  // position triggers it (#1304, M35). patchState keeps the old stamp, so
  // the new last_updated is given here.
  ha.patchState("person.a", { state: "home", last_updated: new clock.Date().toISOString(),
    attributes: { latitude: 50, longitude: 8 } });
  card.hass = ha.hass;
  await clock.advance(30000);
  assert.equal(ha.count("localtrack/history"), 2, "the next tick fetches again");
  assert.equal(card._points.length, 16, "data of the second fetch is shown");
  assert.equal(card._overlayEl.textContent, "", "error cleared");
  assert.equal(card._loading, false);

  // A late answer of the hung call must not overwrite anything.
  ha.release("localtrack/history", { value: { points: [] } });
  await clock.advance(0);
  assert.equal(card._points.length, 16);
});

test("zone-time: hung month fetch → timeout error after 15 s, lock free, next load shows data", async () => {
  const { k, clock } = laden(["LocaltrackZoneTimeCard", "TEXTE_LOCALTRACK_ZONE_TIME_CARD"]);
  const texte = k.TEXTE_LOCALTRACK_ZONE_TIME_CARD.en.texte;
  const ha = createHass({
    clock,
    states: {
      "person.a": { attributes: { friendly_name: "A" } },
      "zone.work": { attributes: { friendly_name: "Work", latitude: 50, longitude: 8, radius: 50 } },
    },
  });
  ha.respond("localtrack/stats", { tracked: ["person.a"] });
  ha.respond("localtrack/zone_time", {
    days: [{ date: "2026-03-02", net_s: 3600, gross_s: 3600 }],
    days_present: 1, total_net_s: 3600, total_gross_s: 3600, total_visits: 1,
  });
  ha.behaveOnce("localtrack/zone_time", { hang: true });

  const card = new k.LocaltrackZoneTimeCard();
  card._month = { year: 2026, month: 3 };
  card.setConfig({ entity: "person.a", zone: "zone.work" });
  card.hass = ha.hass;
  await clock.advance(14999);
  assert.equal(card._loading, true, "still waiting before 15 s");

  await clock.advance(1);
  assert.equal(card._loading, false, "lock released after 15 s");
  assert.equal(card._statusEl.textContent, texte.zeitueberschreitung);

  card._load();
  await clock.advance(0);
  assert.equal(ha.count("localtrack/zone_time"), 2);
  assert.equal(card._statusEl.textContent, "");
  assert.ok(card._bodyEl.children.length > 0, "table rendered");
});
