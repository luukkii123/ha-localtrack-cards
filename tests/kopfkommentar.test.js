"use strict";

// M73 (#1325): the file head lists every card of the bundle. The list is
// compared with the `window.customCards` entries the bundle registers, so a
// new card without a head entry turns this test red.
const test = require("node:test");
const assert = require("node:assert/strict");
const { ladeKarte, quelle } = require("./laden.js");

const SOURCE = quelle();

/** The first doc comment after the synced Shared UI block: the file head. */
function head(source) {
  const own = source.slice(source.indexOf("/* END BUSCH SHARED UI */"));
  return (own.match(/\/\*\*[\s\S]*?\*\//) || [""])[0];
}

/** Card types named in the head list (` *  - `type` …`). */
function headCards(source) {
  return [...head(source).matchAll(/^ \*\s+- `([a-z0-9-]+)`/gm)].map((m) => m[1]);
}

function registeredCards(source) {
  return Array.from(ladeKarte(["CARD_VERSION"], { quelleText: source }).karten, (entry) => entry.type);
}

/** Differences between head list and registry, empty when both agree. */
function mismatch(source) {
  const listed = headCards(source), registered = registeredCards(source);
  return {
    missing: registered.filter((type) => !listed.includes(type)),
    stale: listed.filter((type) => !registered.includes(type)),
    duplicate: listed.filter((type, i) => listed.indexOf(type) !== i),
  };
}

test("M73: the file head lists exactly the cards in window.customCards", () => {
  assert.ok(headCards(SOURCE).length > 0, "the head carries a card list");
  assert.deepEqual(mismatch(SOURCE), { missing: [], stale: [], duplicate: [] });
});

test("M73: a new card without a head entry is reported as missing", () => {
  const extra = `\nBuschUI.register("localtrack-new-card", class extends HTMLElement {}, {
    type: "localtrack-new-card", name: "Local Track New", description: "Shows nothing.", preview: true });\n`;
  assert.deepEqual(mismatch(SOURCE + extra).missing, ["localtrack-new-card"]);
});
