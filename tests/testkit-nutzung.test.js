"use strict";

// M5 (Buschcheck D13, netcode N2; user decision 24.11.2026): every test file
// runs the bundle through the shared test kit (tests/_testkit.cjs): its vm
// loader, its DOM stand-in and, for the zone-time card, its hass stand-in.
// No test keeps an own vm sandbox or an own DOM class; laden.js only adds what
// the kit leaves to the repo (parsed markup, custom element reactions).
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const kit = require("./_testkit.cjs");
const { ladeKarte, einhaengen, zonenKarte, ruhe } = require("./laden.js");

const TESTS = path.join(__dirname);
const quelle = (name) => fs.readFileSync(path.join(TESTS, name), "utf8");

test("laden.js loads through the kit: loadScript, createEnvironment and createHass, no own vm", () => {
  const laden = quelle("laden.js");
  assert.match(laden, /require\("\.\/_testkit\.cjs"\)/);
  for (const name of ["loadScript", "createEnvironment", "createHass"]) {
    assert.match(laden, new RegExp(`kit\\.${name}\\(`), name);
  }
  assert.doesNotMatch(laden, /require\(["']node:vm["']\)/, "own vm sandbox in laden.js");
  assert.doesNotMatch(laden, /class Fake\w+/, "own DOM class in laden.js");
});

test("no test file keeps an own vm sandbox or DOM class", () => {
  const dateien = fs.readdirSync(TESTS).filter((name) => name.endsWith(".test.js"));
  assert.ok(dateien.length >= 30, `test files found: ${dateien.length}`);
  for (const name of dateien) {
    const text = quelle(name);
    assert.doesNotMatch(text, /require\(["']node:vm["']\)/, `${name}: own vm sandbox`);
    assert.doesNotMatch(text, /class Fake\w+/, `${name}: own DOM class`);
    assert.doesNotMatch(text, /\bFakeElement\b/, `${name}: old DOM stand-in`);
  }
});

test("a loaded card is an element of the kit DOM with a parsed shadow tree", () => {
  const k = ladeKarte(["LocaltrackTimelineCard"]);
  assert.equal(k.kontext.window, k.kontext, "window is the vm global");
  const card = new k.LocaltrackTimelineCard();
  assert.ok(card instanceof k.env.HTMLElement, "card extends the kit HTMLElement");
  card.setConfig({ entity: "person.a" });
  assert.ok(card.shadowRoot instanceof k.env.ShadowRoot, "kit shadow root");
  const title = card.shadowRoot.querySelector(".title");
  assert.ok(title instanceof k.env.Element, "skeleton markup parsed into kit elements");
  assert.equal(card.isConnected, false, "not attached yet");
  einhaengen(card);
  assert.equal(card.isConnected, true);
  assert.equal(card.parentNode, k.kontext.document.body);
});

test("zonenKarte uses the kit hass: counters per message type, the card hung in", async () => {
  const { card, ha, aufrufe } = zonenKarte({
    callWS: (msg) => Promise.resolve(msg.type === "localtrack/stats" ? { tracked: ["person.a"] }
      : { days: [], days_present: 0, total_net_s: 0, total_gross_s: 0, total_visits: 0 }),
  });
  await ruhe();
  assert.equal(typeof ha.count, "function", "kit hass controller");
  assert.equal(ha.count("localtrack/stats"), 1);
  assert.equal(ha.count("localtrack/zone_time"), 1);
  assert.equal(aufrufe.length, 2);
  assert.equal(card.isConnected, true);
  assert.equal(kit.TESTKIT_VERSION.split(".")[0], "1");
});
