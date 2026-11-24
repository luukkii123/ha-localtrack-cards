"use strict";

// #1277 M19 (Buschcheck S5): every text a card shows carries each payload of
// XSS_PAYLOADS and must stay text. Covered: timeline card (title, zone names
// in the stay list and the scrubber label, Nominatim place and address names,
// map pins, error status) and zone-time card (person, tracker and zone names
// in menus and title, error status, unexpected strings in the zone_time
// answer). activeMarkup must be empty: the cards render no img, svg or script
// and no on* attribute anywhere, so nothing is exempted.
const test = require("node:test");
const assert = require("node:assert/strict");
const { XSS_PAYLOADS, activeMarkup } = require("./_testkit.cjs");
const { ladeKarte, einhaengen, zonenKarte, ruhe } = require("./laden.js");

const ADDRESS_FIELDS = ["road", "neighbourhood", "suburb", "village", "town", "city", "name"];

/** The whole shadow tree: the kit DOM of laden.js parses the skeleton markup,
 *  so every element the card queried is part of it. */
function rendered(card) {
  return [card.shadowRoot];
}

function assertClean(card, extra = []) {
  const found = [...rendered(card).flatMap((node) => activeMarkup(node)), ...extra.flatMap((html) => activeMarkup(html))];
  assert.deepEqual(found, [], `active markup: ${JSON.stringify(found)}`);
}

/** Leaflet stand-in: records the HTML of every divIcon (the numbered stay pins). */
function leaflet(pins) {
  const layer = () => ({ addTo() { return this; }, setLatLng() { return this; }, clearLayers() {} });
  return {
    layerGroup: layer,
    polyline: layer,
    circleMarker: layer,
    divIcon: (options) => ({ options }),
    marker: (_at, options) => { pins.push(options.icon.options.html); return layer(); },
    latLngBounds: () => ({ pad() { return this; } }),
  };
}

const MAP = {
  removeLayer() {}, setView() {}, fitBounds() {}, invalidateSize() {}, panTo() {},
  getBounds: () => ({ contains: () => true }),
};

/** Two stays of 15 minutes: one inside zone.work, one outside every zone. */
function points() {
  const out = [];
  for (let t = 0; t <= 900; t += 60) out.push({ lat: 50, lon: 8, ts: 1_800_000_000 + t });
  for (let t = 1800; t <= 2700; t += 60) out.push({ lat: 50.05, lon: 8.05, ts: 1_800_000_000 + t });
  return out;
}

function timelineCard({ payload, field, history }) {
  const k = ladeKarte(["LocaltrackTimelineCard"]);
  // Nominatim: nothing at the zone, `field` = payload at the second stay.
  k.kontext.fetch = (url) => Promise.resolve({
    json: () => Promise.resolve(url.includes("lat=50&") ? {} : { address: { [field]: payload }, name: field === "name" ? payload : undefined }),
  });
  const pins = [];
  const card = new k.LocaltrackTimelineCard();
  einhaengen(card);
  card._leaflet = leaflet(pins);
  card._map = MAP;
  card.setConfig({ entity: "person.a", reverse_geocode: true });
  const states = {
    "person.a": { attributes: { friendly_name: payload } },
    "zone.work": { attributes: { friendly_name: payload, latitude: 50, longitude: 8, radius: 50 } },
  };
  card.hass = { states, locale: { language: "en" }, callWS: history };
  return { card, pins };
}

async function settle() {
  for (let i = 0; i < 5; i += 1) await ruhe();
}

for (const [index, payload] of XSS_PAYLOADS.entries()) {
  const field = ADDRESS_FIELDS[index % ADDRESS_FIELDS.length];

  test(`timeline card, payload ${JSON.stringify(payload)} (address.${field}): stays text`, async () => {
    const { card, pins } = timelineCard({
      payload, field,
      history: (msg) => Promise.resolve(msg.type === "localtrack/history"
        ? { points: points(), source: payload, entity_name: payload }
        : {}),
    });
    await settle();
    const labels = card._segmentsEl.querySelectorAll(".label").map((n) => n.textContent);
    assert.equal(card._titleEl.textContent, payload, "title from friendly_name");
    assert.equal(labels[0], payload, "zone name of the first stay");
    assert.equal(labels.at(-1), payload, `address.${field} of the second stay`);
    assert.match(card._scrubLabelEl.textContent, /· /);
    assert.equal(pins.length, 2, "one pin per stay");
    assertClean(card, pins);
  });

  test(`timeline card, payload ${JSON.stringify(payload)} in an error: stays text`, async () => {
    const { card } = timelineCard({
      payload, field,
      history: () => Promise.reject({ code: payload, message: payload }),
    });
    await settle();
    assert.ok(card._overlayEl.textContent.includes(payload), card._overlayEl.textContent);
    assertClean(card);
  });

  test(`zone-time card, payload ${JSON.stringify(payload)}: stays text`, async () => {
    const states = {
      "person.a": { attributes: { friendly_name: payload } },
      "device_tracker.phone": { attributes: { friendly_name: payload } },
      "zone.work": { attributes: { friendly_name: payload, latitude: 50, longitude: 8, radius: 50 } },
      "zone.home": { attributes: { friendly_name: `${payload} home`, latitude: 50, longitude: 8, radius: 100 } },
    };
    const { card } = zonenKarte({
      states,
      month: { year: 2026, month: 3 },
      callWS: (msg) => Promise.resolve(msg.type === "localtrack/stats"
        ? { tracked: ["person.a", "device_tracker.phone"] }
        // The answer is numbers by contract; strings in it must not reach the table as markup.
        : {
          days: [{ date: "2026-03-02", net_s: payload, gross_s: 3600, zone_name: payload }],
          days_present: 1, total_net_s: payload, total_gross_s: 3600, total_visits: 1, entity_name: payload,
        }),
    });
    await settle();
    assert.deepEqual(card._entityEl.children.map((o) => o.textContent), [payload, payload]);
    assert.ok(card._zoneEl.children.map((o) => o.textContent).includes(payload));
    assert.equal(card._titleEl.textContent, payload, "title from the zone name");
    assert.ok(card._bodyEl.children.length > 0, "table rendered");
    assert.doesNotMatch(card._bodyEl.textContent + card._footEl.textContent, /onerror|onload|alert/);
    assertClean(card);
  });

  test(`zone-time card, payload ${JSON.stringify(payload)} in an error: stays text`, async () => {
    const { card } = zonenKarte({
      states: { "person.a": { attributes: { friendly_name: payload } },
        "zone.work": { attributes: { friendly_name: payload, latitude: 50, longitude: 8, radius: 50 } } },
      callWS: (msg) => (msg.type === "localtrack/stats"
        ? Promise.resolve({ tracked: ["person.a"] })
        : Promise.reject({ code: payload, message: payload })),
    });
    await settle();
    assert.ok(card._statusEl.textContent.includes(payload), card._statusEl.textContent);
    assertClean(card);
  });
}

test("zone-time card: zone without coordinates names its id as text", async () => {
  const payload = XSS_PAYLOADS[0];
  const { card } = zonenKarte({
    states: { "person.a": { attributes: { friendly_name: "A" } } },
    config: { zone: `zone.${payload}` },
    callWS: () => Promise.resolve({ tracked: ["person.a"] }),
  });
  await settle();
  assert.ok(card._statusEl.textContent.includes(payload), card._statusEl.textContent);
  assertClean(card);
});
