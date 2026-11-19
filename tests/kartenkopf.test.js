"use strict";

// M61 (Buschcheck W11): one card header across the families. Both titles go
// through BuschUI.header({level: 1}) (HA card header size, weight medium);
// the cards no longer set a title size or weight of their own.

const test = require("node:test");
const assert = require("node:assert/strict");
const { ladeKarte, quelle } = require("./laden");

const FAELLE = [
  ["LocaltrackTimelineCard", { entity: "person.a", title: "Weg" }],
  ["LocaltrackZoneTimeCard", { entity: "person.a", zone: "zone.work", title: "Ort" }],
];

for (const [klasse, config] of FAELLE) {
  test(`${klasse}: title is a level-1 BuschUI header`, () => {
    const k = ladeKarte([klasse]);
    const card = new k[klasse]();
    card.setConfig(config);
    assert.equal(card._titleEl.textContent, config.title);
    assert.equal(card._titleEl.getAttribute("data-level"), "1");
    assert.match(card._titleEl.className, /\bbusch-ui-title\b/);
    assert.equal(card._titleEl.getAttribute("role"), "heading");
  });
}

test("no card sets its own title size or weight", () => {
  const code = quelle().replace(/\/\* BEGIN BUSCH SHARED UI[\s\S]*?\/\* END BUSCH SHARED UI \*\//, "");
  for (const block of code.matchAll(/(?:^|[\s}])\.title\s*\{([^}]*)\}/g)) {
    assert.ok(!/font-(size|weight)/.test(block[1]), block[0]);
  }
});
