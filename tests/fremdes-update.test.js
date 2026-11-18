"use strict";

// #1304 M22 (Buschcheck P7): a hass update that concerns neither the card's
// person nor a zone must not scan hass.states, rebuild a menu or write a
// text. Zone ids are found again only for a new hass.entities object, menu
// options only when a zone or person state object changed, texts only when
// they differ. Counts writes on the card's own elements (no MutationObserver
// in the sandbox) and key enumerations of hass.states.
const test = require("node:test");
const assert = require("node:assert/strict");
const { ladeKarte, zonenKarte, zustaende, ruhe } = require("./laden.js");

/** Records every write on `el` into `log`: attributes, children, text, title. */
function beobachte(el, log, name) {
  for (const method of ["setAttribute", "removeAttribute", "replaceChildren", "appendChild"]) {
    const original = el[method].bind(el);
    el[method] = (...args) => { log.push(`${name}.${method}`); return original(...args); };
  }
  for (const prop of ["textContent", "title", "innerHTML"]) {
    let proto = el;
    let desc;
    while (proto && !(desc = Object.getOwnPropertyDescriptor(proto, prop))) proto = Object.getPrototypeOf(proto);
    let value = desc && "value" in desc ? desc.value : undefined;
    Object.defineProperty(el, prop, {
      configurable: true,
      get() { return desc?.get ? desc.get.call(el) : value; },
      set(v) { log.push(`${name}.${prop}`); if (desc?.set) desc.set.call(el, v); else value = v; },
    });
  }
}

/** hass.states as a proxy that counts Object.keys/entries over it. */
function gezaehlt(states, zaehler) {
  return new Proxy(states, { ownKeys(target) { zaehler.scans += 1; return Reflect.ownKeys(target); } });
}

/** 3 000 foreign entities besides the test people and zones. */
function vieleZustaende() {
  const states = zustaende();
  for (let i = 0; i < 3000; i += 1) states[`sensor.s${i}`] = { state: String(i), attributes: {} };
  return states;
}

test("zone-time card: a foreign update scans nothing and writes nothing", async () => {
  const entities = {};
  const zaehler = { scans: 0 };
  const { card, hass } = zonenKarte({
    states: vieleZustaende(),
    callWS: (msg) => Promise.resolve(msg.type === "localtrack/stats" ? { tracked: ["person.a", "person.b"] }
      : { days: [], days_present: 0, total_net_s: 0, total_gross_s: 0, total_visits: 0 }),
  });
  let plain = { ...hass.states };
  card.hass = { ...hass, entities, states: gezaehlt(plain, zaehler) };
  await ruhe();
  const log = [];
  const root = card.shadowRoot;
  beobachte(card._titleEl, log, "title");
  beobachte(card._entityEl, log, "entity");
  beobachte(card._zoneEl, log, "zone");
  for (const sel of [".head", "th.day", "th.net", "th.gross", ".prev", ".next"]) beobachte(root.querySelector(sel), log, sel);
  zaehler.scans = 0;

  for (let i = 0; i < 5; i += 1) {
    plain = { ...plain, [`sensor.s${i}`]: { state: "neu", attributes: {} } };
    card.hass = { ...card._hass, entities, states: gezaehlt(plain, zaehler) };
  }
  assert.equal(zaehler.scans, 0, "hass.states was enumerated on a foreign update");
  assert.deepEqual(log, [], "writes on a foreign update");
});

test("zone-time card: a changed zone updates menu and title, a new registry finds a new zone", async () => {
  const zaehler = { scans: 0 };
  const { card, hass } = zonenKarte({
    callWS: (msg) => Promise.resolve(msg.type === "localtrack/stats" ? { tracked: ["person.a"] }
      : { days: [], days_present: 0, total_net_s: 0, total_gross_s: 0, total_visits: 0 }),
  });
  const entities = {};
  card.hass = { ...hass, entities };
  await ruhe();
  const log = [];
  beobachte(card._zoneEl, log, "zone");
  beobachte(card._titleEl, log, "title");

  const plain = card._hass.states;
  const work = plain["zone.work"];
  const renamed = { ...work, attributes: { ...work.attributes, friendly_name: "Office" } };
  const next = { ...plain, "zone.work": renamed };
  card.hass = { ...card._hass, entities, states: gezaehlt(next, zaehler) };
  assert.equal(zaehler.scans, 0, "a known zone needs no scan");
  assert.equal(log.filter((e) => e === "zone.replaceChildren").length, 1, "zone menu rebuilt once");
  assert.equal(log.filter((e) => e === "title.textContent").length, 1, "title written once");
  assert.equal(card._titleEl.textContent, "Office");
  assert.ok(card._zoneEl.children.some((o) => o.textContent === "Office"));

  const gym = { attributes: { friendly_name: "Gym", latitude: 50, longitude: 8, radius: 30 } };
  card.hass = { ...card._hass, entities: { ...entities, "zone.gym": {} },
    states: gezaehlt({ ...next, "zone.gym": gym }, zaehler) };
  assert.equal(zaehler.scans, 1, "a new hass.entities object scans once");
  assert.deepEqual(card._zoneEl.children.map((o) => o.value), ["zone.gym", "zone.home", "zone.work"]);
});

test("timeline card: a foreign update writes no title, label or attribute", async () => {
  const k = ladeKarte(["LocaltrackTimelineCard"]);
  const card = new k.LocaltrackTimelineCard();
  card._leaflet = { layerGroup: () => ({ addTo() { return this; }, clearLayers() {} }) };
  card._map = { setView() {}, removeLayer() {}, invalidateSize() {} };
  card.setConfig({ entity: "person.a" });
  const states = zustaende();
  const hass = { states, entities: {}, locale: { language: "en" }, callWS: () => Promise.resolve({ points: [] }) };
  card.hass = hass;
  await ruhe();
  const log = [];
  beobachte(card._titleEl, log, "title");
  beobachte(card._dateEl, log, "date");
  beobachte(card._scrubberEl, log, "scrubber");
  beobachte(card.shadowRoot.querySelector(".header"), log, "header");

  for (let i = 0; i < 5; i += 1) {
    card.hass = { ...card._hass, states: { ...card._hass.states, [`sensor.s${i}`]: { attributes: {} } } };
  }
  assert.deepEqual(log, [], "writes on a foreign update");

  const a = card._hass.states["person.a"];
  card.hass = { ...card._hass, states: { ...card._hass.states,
    "person.a": { ...a, attributes: { ...a.attributes, friendly_name: "Anna" } } } };
  assert.equal(card._titleEl.textContent, "Anna");
  assert.ok(log.includes("title.textContent"));
  card.hass = { ...card._hass, locale: { language: "de" } };
  assert.ok(log.includes("date.title"), "a new language rewrites the labels");
});
