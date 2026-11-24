"use strict";

// M27 (Buschcheck, F4/W3): both cards announce loading, empty and error
// states. The status region exists in the markup from `_build` on (a live
// region added together with its text is not announced), loading/empty are
// role=status + aria-live=polite, an error is role=alert. The state is drawn
// by BuschUI.stateBlock into that same node (icon, title).

const test = require("node:test");
const assert = require("node:assert/strict");
const { ladeKarte, einhaengen, zonenKarte, ruhe, offen, parseHtml } = require("./laden");

/** All elements of a markup string, depth first. */
function alle(html) {
  const out = [];
  const walk = (nodes) => {
    for (const n of nodes) if (n.nodeType === 1) { out.push(n); walk(n.childNodes); }
  };
  walk(parseHtml(html));
  return out;
}

function mitKlasse(html, klasse) {
  return alle(html).find((el) => String(el.className).split(/\s+/).includes(klasse));
}

function timeline(callWS) {
  const k = ladeKarte(["LocaltrackTimelineCard"]);
  const card = new k.LocaltrackTimelineCard();
  // A drawn map without Leaflet (as in zeitgrenze.test.js): only the state matters here.
  const layer = () => ({ addTo() { return this; }, setLatLng() { return this; }, clearLayers() {} });
  card._leaflet = { layerGroup: layer, polyline: layer, circleMarker: layer, marker: layer,
    divIcon: (options) => ({ options }), latLngBounds: () => ({ pad() { return this; } }) };
  card._map = { removeLayer() {}, setView() {}, fitBounds() {}, invalidateSize() {}, panTo() {},
    getBounds: () => ({ contains: () => true }) };
  card.setConfig({ entity: "person.a" });
  const markup = card.shadowRoot.innerHTML;
  einhaengen(card);
  card.hass = { states: { "person.a": { attributes: {} } }, locale: { language: "en" }, callWS };
  return { card, markup };
}

function titel(region) {
  return region.children.find((n) => String(n.className).includes("busch-state-text"))
    ?.children.find((n) => String(n.className).includes("busch-state-title"))?.textContent;
}

test("timeline: the map overlay is a polite status region in the markup of _build", () => {
  const { markup } = timeline(() => new Promise(() => {}));
  const region = mitKlasse(markup, "map-overlay");
  assert.ok(region, "overlay in markup");
  assert.equal(region.getAttribute("role"), "status");
  assert.equal(region.getAttribute("aria-live"), "polite");
});

test("timeline: loading, empty and error go through one stateBlock region", async () => {
  const antwort = offen();
  const { card } = timeline(() => antwort.promise);
  const region = card._overlayEl;
  assert.equal(region.getAttribute("role"), "status", "loading is a status");
  assert.equal(region.getAttribute("aria-busy"), "true");
  assert.equal(region.dataset.kind ?? region.getAttribute("data-kind"), "loading");
  assert.equal(titel(region), card._t.laden);
  antwort.resolve({ points: [] });
  await ruhe(); await ruhe();
  assert.equal(region.getAttribute("data-kind"), "empty");
  assert.equal(region.getAttribute("role"), "status");
  assert.equal(region.getAttribute("aria-busy"), null);
  assert.equal(titel(region), card._t.keine_punkte);
  card._hass.callWS = () => Promise.reject({ code: "unauthorized" });
  await card._loadDay();
  assert.equal(region.getAttribute("role"), "alert", "an error interrupts");
  assert.equal(region.getAttribute("aria-live"), "assertive");
  assert.equal(titel(region), card._t.keine_berechtigung);
});

test("zone time: the status line is a polite status region in the markup of _build", () => {
  const k = ladeKarte(["LocaltrackZoneTimeCard"]);
  const card = new k.LocaltrackZoneTimeCard();
  card.setConfig({ entity: "person.a", zone: "zone.work" });
  const region = mitKlasse(card.shadowRoot.innerHTML, "status");
  assert.ok(region, "status in markup");
  assert.equal(region.getAttribute("role"), "status");
  assert.equal(region.getAttribute("aria-live"), "polite");
});

test("zone time: loading, an empty month and an error use the same region", async () => {
  let antwort = offen();
  const { card, texte } = zonenKarte({
    callWS: (msg) => (msg.type === "localtrack/stats" ? Promise.resolve({ tracked: ["person.a"] }) : antwort.promise),
  });
  const region = card._statusEl;
  assert.equal(region.getAttribute("data-kind"), "loading");
  assert.equal(region.getAttribute("role"), "status");
  assert.equal(titel(region), texte.laden);
  antwort.resolve({ days: [], days_present: 0, total_net_s: 0, total_gross_s: 0, total_visits: 0 });
  await ruhe(); await ruhe(); await ruhe();
  assert.equal(region.hidden, false, "an empty month shows the empty state");
  assert.equal(region.getAttribute("data-kind"), "empty");
  assert.equal(titel(region), texte.keine_anwesenheit);
  assert.equal(card._noteEl.textContent, "", "no second empty text in the note line");
  antwort = offen();
  card._month = { year: 2020, month: 1 };
  const laden = card._load();
  antwort.reject({ code: "failure", message: "kaputt" });
  await laden;
  assert.equal(region.getAttribute("role"), "alert");
  assert.equal(region.getAttribute("data-kind"), "error");
  assert.match(titel(region), /kaputt/);
});
