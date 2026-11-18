"use strict";

// #1011 card picker, as in the other repos: name, one sentence of
// description, explicit preview flag, defaults without network.
// Unlike the other repos `preview` stays true here: decision E11 (18.11.2026)
// keeps a preview for Local Track; it is static (M53, kartenwaehler-vorschau.test.js).
const test = require("node:test");
const assert = require("node:assert/strict");
const { ladeKarte } = require("./laden.js");

const TYPEN = ["localtrack-timeline-card", "localtrack-zone-time-card"];

test("every card picker entry: name 'Local Track …', one sentence, explicit preview (de and en)", () => {
  for (const sprache of ["de-DE", "en-US"]) {
    const { karten } = ladeKarte(["CARD_VERSION"], { sprache });
    assert.deepEqual(Array.from(karten, (e) => e.type), TYPEN);
    for (const e of karten) {
      assert.equal(typeof e.preview, "boolean", `${e.type}: preview must be explicit`);
      assert.match(e.name, /^Local Track \S/, `${e.type}: name ${e.name}`);
      assert.match(e.description, /^[A-ZÄÖÜ].*[^.]\.$/, `${e.type}: one sentence with a period: ${e.description}`);
      assert.ok(!/[.!?] /.test(e.description), `${e.type}: exactly one sentence: ${e.description}`);
      assert.match(e.documentationURL, /^https:\/\/github\.com\/[^/]+\/ha-localtrack-cards$/);
    }
  }
});

test("card picker language follows navigator.language", () => {
  const de = ladeKarte(["CARD_VERSION"], { sprache: "de-DE" }).karten;
  const en = ladeKarte(["CARD_VERSION"], { sprache: "en-US" }).karten;
  assert.notEqual(de[0].description, en[0].description);
  assert.notEqual(de[1].name, en[1].name);
});

test("every card and editor is registered", () => {
  const { elements } = ladeKarte(["CARD_VERSION"]);
  for (const type of TYPEN) {
    assert.ok(elements.get(type), type);
    assert.ok(elements.get(`${type}-editor`), `${type}-editor`);
  }
});

test("getStubConfig reads only hass.states (no network, no other hass field)", () => {
  const { elements } = ladeKarte(["CARD_VERSION"]);
  const states = {
    "device_tracker.phone": { attributes: {} },
    "person.a": { attributes: {} },
    "zone.home": { attributes: { radius: 100 } },
    "zone.big": { attributes: { radius: 500 } },
    "zone.small": { attributes: { radius: 40 } },
  };
  const hass = new Proxy({ states }, {
    get(target, key) {
      if (key === "states") return target.states;
      throw new Error("hass." + String(key) + " read");
    },
  });
  assert.deepEqual({ ...elements.get(TYPEN[0]).getStubConfig(hass) },
    { type: "custom:localtrack-timeline-card", entity: "person.a" });
  assert.deepEqual({ ...elements.get(TYPEN[1]).getStubConfig(hass) },
    { type: "custom:localtrack-zone-time-card", entity: "person.a", zone: "zone.small" });
});

test("getStubConfig without hass gives empty defaults", () => {
  const { elements } = ladeKarte(["CARD_VERSION"]);
  assert.equal(elements.get(TYPEN[0]).getStubConfig(undefined).entity, "");
  assert.deepEqual({ ...elements.get(TYPEN[1]).getStubConfig({}) },
    { type: "custom:localtrack-zone-time-card", entity: "", zone: "zone.home" });
});
