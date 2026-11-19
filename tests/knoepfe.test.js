"use strict";

// M62 (Buschcheck W12): one button. The day buttons of the timeline and the
// month buttons of the zone-time card are BuschUI .busch-btn buttons (44 px,
// focus ring, tokens) instead of a look of their own per card.

const test = require("node:test");
const assert = require("node:assert/strict");
const { ladeKarte, parseHtml, quelle } = require("./laden");

function knoepfe(html) {
  const out = [];
  const walk = (nodes) => {
    for (const n of nodes) if (n.nodeType === 1) { if (n.tagName === "BUTTON") out.push(n); walk(n.childNodes); }
  };
  walk(parseHtml(html));
  return out;
}

const KARTEN = [
  ["LocaltrackTimelineCard", { entity: "person.a" }, ["day-prev", "day-next"]],
  ["LocaltrackZoneTimeCard", { entity: "person.a", zone: "zone.work" }, ["prev", "next"]],
];

for (const [klasse, config, namen] of KARTEN) {
  test(`${klasse}: every button of the skeleton is a .busch-btn`, () => {
    const k = ladeKarte([klasse]);
    const card = new k[klasse]();
    card.setConfig(config);
    const liste = knoepfe(card.shadowRoot.innerHTML);
    assert.deepEqual(liste.map((b) => b.className.split(/\s+/).find((c) => namen.includes(c))).sort(), [...namen].sort());
    for (const b of liste) assert.ok(b.className.split(/\s+/).includes("busch-btn"), b.className);
  });
}

test("no card styles its own button look any more", () => {
  const css = quelle().replace(/\/\* BEGIN BUSCH SHARED UI[\s\S]*?\/\* END BUSCH SHARED UI \*\//, "");
  assert.ok(!/\.controls button\s*\{/.test(css), "own .controls button rule");
  assert.ok(!/\.month button\s*\{/.test(css), "own .month button rule");
});
