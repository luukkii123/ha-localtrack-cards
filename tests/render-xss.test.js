"use strict";

// #1328 M1 (Buschcheck S1, Nachholetappe J): the Node tests prove the menus in a
// fake DOM; the Chromium counter-check proves it in a real browser, where
// `<img onerror>` inside `<select>` survives parsing since Chromium 135. These
// tests hold the render script docs/render/zonetime.py to that case: the
// payloads come from the testkit (one source), every one is a friendly_name,
// the shadow DOM must hold no img, the payload must be visible as text, and the
// result lands in report.json. The browser run itself is the final proof.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { XSS_PAYLOADS } = require("./_testkit.cjs");

const ROOT = path.join(__dirname, "..");
const ZONETIME = fs.readFileSync(path.join(ROOT, "docs", "render", "zonetime.py"), "utf8");
const DOCS = fs.readFileSync(path.join(ROOT, "docs", "entwicklung.md"), "utf8");

test("M1: zonetime.py takes the XSS payloads from the testkit, not a copy", () => {
  assert.match(ZONETIME, /"_testkit\.cjs"/, "testkit path");
  assert.match(ZONETIME, /def xss_payloads\(/, "payload reader");
  assert.ok(XSS_PAYLOADS.some((p) => p.includes("<img")), "the testkit carries an img payload");
});

test("M1: zonetime.py renders a payload friendly_name and counts img in the shadow DOM", () => {
  assert.match(ZONETIME, /friendly_name/);
  assert.match(ZONETIME, /querySelectorAll\(['"]img['"]\)\.length/, "img count in the shadow DOM");
  assert.match(ZONETIME, /checks\[["']XSS[^"']*kein img/, "verdict: no img");
  assert.match(ZONETIME, /checks\[["']XSS[^"']*als Text/, "verdict: payload shown as text");
});

test("M1: the counter-check result is written to report.json", () => {
  assert.match(ZONETIME, /"xss":\s*xss/, "report key xss");
});

test("M1: docs/entwicklung.md names the Chromium counter-check", () => {
  assert.match(DOCS, /Chromium-Gegenprobe/);
  assert.match(DOCS, /XSS_PAYLOADS/);
});
