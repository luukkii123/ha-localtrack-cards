"use strict";

// Buschcheck M56 (F5, W19): every control of the timeline says what it is and
// what it holds. The time slider reports its visible value as
// `aria-valuetext`, a stay or trip row names time span, place and duration,
// the day can be stepped with labelled buttons, the date field follows
// `hass.locale`. Buttons have their name right after `_build`, before `hass`.
const test = require("node:test");
const assert = require("node:assert/strict");
const { ladeKarte, parseHtml, ruhe, offen } = require("./laden.js");

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

/** A stay in zone.work, a trip, a stay outside every zone. */
function points() {
  const out = [];
  for (let t = 0; t <= 900; t += 60) out.push({ lat: 50, lon: 8, ts: 1_800_000_000 + t });
  for (let t = 960; t < 1800; t += 120) out.push({ lat: 50 + t / 36000, lon: 8 + t / 36000, ts: 1_800_000_000 + t });
  for (let t = 1800; t <= 2700; t += 60) out.push({ lat: 50.05, lon: 8.05, ts: 1_800_000_000 + t });
  return out;
}

async function settle() {
  for (let i = 0; i < 5; i += 1) await ruhe();
}

function timeline({ language = "en", config = {}, fetch } = {}) {
  const k = ladeKarte(["LocaltrackTimelineCard", "TEXTE_LOCALTRACK_TIMELINE_CARD"]);
  k.kontext.L = leaflet();
  k.kontext.ResizeObserver = class { observe() {} disconnect() {} };
  if (fetch) k.kontext.fetch = fetch;
  const card = new k.LocaltrackTimelineCard();
  card.isConnected = true;
  card.setConfig({ entity: "person.a", ...config });
  const calls = [];
  const hass = {
    states: {
      "person.a": { attributes: { friendly_name: "A" } },
      "zone.work": { attributes: { friendly_name: "Work", latitude: 50, longitude: 8, radius: 50 } },
    },
    entities: {},
    locale: { language },
    callWS: (msg) => { calls.push(msg); return Promise.resolve({ points: points(), total: 30, simplified: false }); },
  };
  return { k, card, hass, calls, texte: k.TEXTE_LOCALTRACK_TIMELINE_CARD[language === "de" ? "de" : "en"].texte };
}

test("timeline: the slider reports its visible value as aria-valuetext after scrubbing", async () => {
  const { card, hass } = timeline();
  card.hass = hass;
  await settle();
  const slider = card._scrubberEl;
  assert.equal(slider.getAttribute("aria-valuetext"), card._scrubLabelEl.textContent, "value text after load");
  const before = slider.getAttribute("aria-valuetext");
  slider.value = "20";
  slider.listeners.input[0]();
  const after = slider.getAttribute("aria-valuetext");
  assert.notEqual(after, before, "value text follows the slider");
  assert.equal(after, card._scrubLabelEl.textContent);
  assert.match(after, /· on the move$/);
});

test("timeline: an empty day removes the value text", async () => {
  const { card, hass } = timeline();
  card.hass = hass;
  await settle();
  card._clearDayDetails();
  assert.equal(card._scrubberEl.getAttribute("aria-valuetext"), null);
});

test("timeline: slider and date carry a visible label from the dictionary", () => {
  const { card, texte } = timeline();
  const root = card.shadowRoot;
  assert.equal(root.querySelector(".scrub-name").textContent, texte.zeitpunkt);
  assert.equal(card._scrubberEl.getAttribute("aria-label"), texte.zeitpunkt);
  assert.equal(root.querySelector(".day-name").textContent, texte.tag);
  const markup = parseHtml(root.innerHTML);
  const all = markup.flatMap((n) => (n.nodeType === 1 ? [n, ...n.descendants()] : []));
  const byTag = (tag) => all.filter((n) => n.tagName === tag.toUpperCase());
  const labelFor = (id) => byTag("label").find((l) => l.getAttribute("for") === id);
  const range = byTag("input").find((i) => i.getAttribute("type") === "range");
  const date = byTag("input").find((i) => i.getAttribute("type") === "date");
  assert.ok(labelFor(range.getAttribute("id")), "slider has a <label for>");
  assert.ok(labelFor(date.getAttribute("id")), "date field has a <label for>");
});

test("timeline: day buttons have a name and type right after _build, before hass", () => {
  const { card, texte } = timeline();
  const root = card.shadowRoot;
  const prev = root.querySelector(".day-prev");
  const next = root.querySelector(".day-next");
  assert.equal(prev.getAttribute("aria-label"), texte.voriger_tag);
  assert.equal(next.getAttribute("aria-label"), texte.naechster_tag);
  assert.equal(prev.type, "button");
  assert.equal(next.type, "button");
  const buttons = parseHtml(root.innerHTML).flatMap((n) => (n.nodeType === 1 ? [n, ...n.descendants()] : []))
    .filter((n) => n.tagName === "BUTTON");
  assert.equal(buttons.length, 2);
  assert.ok(buttons.every((b) => b.getAttribute("type") === "button"), "type in the markup");
});

test("timeline: previous and next day step the date and load that day", async () => {
  const { card, hass, calls } = timeline();
  card.hass = hass;
  await settle();
  card._day = "2026-03-01";
  card._dateEl.value = card._day;
  const prev = card.shadowRoot.querySelector(".day-prev");
  const next = card.shadowRoot.querySelector(".day-next");
  prev.listeners.click[0]({ stopPropagation() {} });
  await settle();
  assert.equal(card._day, "2026-02-28");
  assert.equal(card._dateEl.value, "2026-02-28");
  next.listeners.click[0]({ stopPropagation() {} });
  next.listeners.click[0]({ stopPropagation() {} });
  await settle();
  assert.equal(card._day, "2026-03-02");
  const last = calls[calls.length - 1];
  assert.equal(new Date(last.start).getDate(), 2, "the newest day was loaded last");
});

test("timeline: a row names time span, place and duration and says what it does", async () => {
  const { card, hass, texte } = timeline();
  card.hass = hass;
  await settle();
  const rows = card._segmentsEl.children;
  assert.ok(rows.length >= 3);
  for (const row of rows) {
    const parts = [".times", ".label", ".meta"].map((sel) => row.querySelector(sel).textContent);
    assert.equal(row.getAttribute("aria-label"), parts.join(", "));
    assert.equal(row.getAttribute("aria-description"), texte.zeigt_auf_karte);
  }
});

test("timeline: a place name filled in later also renames its row", async () => {
  const pending = [];
  const { card, hass } = timeline({
    config: { reverse_geocode: true },
    fetch: () => { const o = offen(); pending.push(o); return o.promise; },
  });
  card.hass = hass;
  await settle();
  pending.shift().resolve({ json: () => Promise.resolve({ address: { road: "Hauptstraße" } }) });
  await settle();
  const row = card._segmentsEl.children.find((r) => r.querySelector(".label").textContent === "Hauptstraße");
  assert.ok(row, "place name arrived");
  assert.match(row.getAttribute("aria-label"), /, Hauptstraße, /);
});

test("timeline: the date field follows hass.locale, written only on a change", async () => {
  const { card, hass } = timeline({ language: "de" });
  card.hass = hass;
  await settle();
  assert.equal(card._dateEl.getAttribute("lang"), "de");
  let writes = 0;
  const original = card._dateEl.setAttribute.bind(card._dateEl);
  card._dateEl.setAttribute = (...args) => { writes += 1; return original(...args); };
  card.hass = { ...card._hass, states: { ...card._hass.states } };
  assert.equal(writes, 0, "same locale writes nothing");
  card.hass = { ...card._hass, locale: { language: "en-GB" } };
  assert.equal(card._dateEl.getAttribute("lang"), "en-GB");
});

test("zone-time: month buttons have a name and type right after _build", () => {
  const k = ladeKarte(["LocaltrackZoneTimeCard", "TEXTE_LOCALTRACK_ZONE_TIME_CARD"]);
  const card = new k.LocaltrackZoneTimeCard();
  card.setConfig({ entity: "person.a", zone: "zone.work" });
  const texte = k.TEXTE_LOCALTRACK_ZONE_TIME_CARD.en.texte;
  const root = card.shadowRoot;
  assert.equal(root.querySelector(".prev").getAttribute("aria-label"), texte.voriger_monat);
  assert.equal(root.querySelector(".next").getAttribute("aria-label"), texte.naechster_monat);
  const buttons = parseHtml(root.innerHTML).flatMap((n) => (n.nodeType === 1 ? [n, ...n.descendants()] : []))
    .filter((n) => n.tagName === "BUTTON");
  assert.equal(buttons.length, 2);
  assert.ok(buttons.every((b) => b.getAttribute("type") === "button"), "type in the markup");
});
