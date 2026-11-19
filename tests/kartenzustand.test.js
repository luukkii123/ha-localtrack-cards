"use strict";

// The state box over the timeline map (M27, M51), from the image review of
// #1318 (render run 2026-11-19): the CSS rules that keep the box clean. The
// measured proof is in the render runs (shared_ui_contract.py: corner pixels
// of the empty/loading/error map; render.py: stale-loading hint position and
// contrast); these tests keep the rules from going away.

const test = require("node:test");
const assert = require("node:assert/strict");
const { quelle } = require("./laden");

const KARTE = quelle()
  .replace(/\/\* BEGIN BUSCH SHARED UI[\s\S]*?\/\* END BUSCH SHARED UI \*\//, "")
  .replace(/\/\* BEGIN VENDOR ([\w-]+)[\s\S]*?\/\* END VENDOR \1 \*\//g, "")
  .replace(/\$\{[^{}]*\}/g, "var(--busch-token)");

/** Declarations of the CSS rule whose selector (last line) is `selektor`, or null. */
function regel(selektor) {
  for (const block of KARTE.matchAll(/([^{}]*)\{([^{}]*)\}/g)) {
    if (block[1].trim().split("\n").pop().trim() !== selektor) continue;
    return Object.fromEntries(block[2].split(";").map((d) => d.split(":"))
      .filter((d) => d.length > 1).map(([k, ...v]) => [k.trim(), v.join(":").trim()]));
  }
  return null;
}

test("state box without old content: the empty map under it is not painted", () => {
  // Overlay and map are clipped by the same rounded corners; anti-aliasing
  // let the map surface (Leaflet #ddd) shine through as corner arcs.
  const r = regel("ha-card:not(.stale) .map-wrap.busy .map");
  assert.ok(r, "rule for the busy map without old content");
  assert.equal(r.visibility, "hidden");
});

test("stale loading hint: a compact box at the top, not over the middle of the map", () => {
  const r = regel(".map-overlay.stale");
  assert.ok(r, "rule .map-overlay.stale");
  assert.equal(r.bottom, "auto", "box ends at its content, the map below stays free");
  assert.match(r.top || r.inset || "", /var\(--ha-space-2/, "box sits at the top edge");
  assert.equal(r.overflow, undefined, "overflow hidden comes from .map-overlay");
  assert.match(r["max-width"] || "", /calc\(100% - /, "box stays inside the map");
});

test("stale loading: the old map is dimmed itself, not by a see-through hint", () => {
  const r = regel("ha-card.stale .map");
  assert.ok(r, "rule ha-card.stale .map");
  assert.ok(Number(r.opacity) > 0 && Number(r.opacity) < 1, `opacity ${r.opacity}`);
});
