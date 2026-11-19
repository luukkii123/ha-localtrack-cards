"use strict";

// M42 (Buschcheck D8): the bundle loaded twice into one page (two resource
// URLs, a cache parameter) must not throw NotSupportedError on the second
// customElements.define, and the card picker lists each card once. The
// registration goes through BuschUI.register.

const test = require("node:test");
const assert = require("node:assert/strict");
const { ladeKarte, gemeinsamerRealm, quelle } = require("./laden");

const TAGS = ["localtrack-timeline-card", "localtrack-timeline-card-editor",
  "localtrack-zone-time-card", "localtrack-zone-time-card-editor"];

test("second load into the same realm: no error, the first classes stay, no duplicate picker entries", () => {
  const realm = gemeinsamerRealm();
  ladeKarte(["CARD_VERSION"], { realm });
  const erste = TAGS.map((tag) => realm.elements.get(tag));
  assert.ok(erste.every(Boolean), "all four registered by the first load");
  assert.doesNotThrow(() => ladeKarte(["CARD_VERSION"], { realm }));
  assert.deepEqual(TAGS.map((tag) => realm.elements.get(tag)), erste, "the first definitions stay");
  // Array.from: the list was made in the sandbox realm, compare plain values.
  assert.deepEqual(Array.from(realm.customCards, (e) => e.type), ["localtrack-timeline-card", "localtrack-zone-time-card"]);
});

test("cards and editors are registered through BuschUI.register only", () => {
  const code = quelle().replace(/\/\* BEGIN BUSCH SHARED UI[\s\S]*?\/\* END BUSCH SHARED UI \*\//, "");
  assert.ok(!/customElements\.define\(/.test(code), "direct customElements.define");
  assert.ok(!/customCards\.push\(/.test(code), "direct customCards.push");
  for (const tag of TAGS) assert.match(code, new RegExp(`BuschUI\\.register\\("${tag}"`), tag);
});
