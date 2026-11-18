"use strict";

// #1264 M1/M20: loading of the zone-time card — tracked people with retry,
// overlapping loads, error status.
const test = require("node:test");
const assert = require("node:assert/strict");
const { zonenKarte, ruhe, offen } = require("./laden.js");

const MONAT = { year: 2026, month: 3 };

function ergebnis(netS) {
  return {
    days: [{ date: "2026-03-02", net_s: netS, gross_s: netS }],
    days_present: 1,
    total_net_s: netS,
    total_gross_s: netS,
    total_visits: 1,
  };
}

test("first localtrack/stats rejected, second succeeds: the people are filled", async () => {
  let statsCalls = 0;
  const { card, aufrufe } = zonenKarte({
    month: MONAT,
    callWS: (msg) => {
      if (msg.type === "localtrack/stats") {
        statsCalls += 1;
        return statsCalls === 1
          ? Promise.reject(new Error("socket closed"))
          : Promise.resolve({ tracked: ["person.a", "person.b"] });
      }
      return Promise.resolve(ergebnis(3600));
    },
  });
  await ruhe();
  assert.equal(card._tracked, null, "a failure must not be cached");
  assert.deepEqual(card._entityEl.children.map((o) => o.value), ["person.a"], "fallback: configured person");
  card._load();
  await ruhe();
  assert.equal(aufrufe.filter((m) => m.type === "localtrack/stats").length, 2);
  assert.deepEqual(card._entityEl.children.map((o) => o.value), ["person.a", "person.b"]);
});

test("a cached success is not asked again", async () => {
  const { card, aufrufe } = zonenKarte({
    month: MONAT,
    callWS: (msg) => Promise.resolve(msg.type === "localtrack/stats" ? { tracked: ["person.a"] } : ergebnis(60)),
  });
  await ruhe();
  card._load();
  await ruhe();
  card._load();
  await ruhe();
  assert.equal(aufrufe.filter((m) => m.type === "localtrack/stats").length, 1);
});

test("after a failure, a hass update asks again only once 60 s have passed", async () => {
  let fail = true;
  const { card, hass, aufrufe } = zonenKarte({
    month: MONAT,
    callWS: (msg) => {
      if (msg.type === "localtrack/stats") {
        return fail ? Promise.reject(new Error("timeout")) : Promise.resolve({ tracked: ["person.a", "person.b"] });
      }
      return Promise.resolve(ergebnis(60));
    },
  });
  await ruhe();
  const statsCount = () => aufrufe.filter((m) => m.type === "localtrack/stats").length;
  assert.equal(statsCount(), 1);
  fail = false;
  card.hass = { ...hass };
  await ruhe();
  assert.equal(statsCount(), 1, "retried before 60 s");
  card._trackedFailedAt -= 60000;
  card.hass = { ...hass };
  await ruhe();
  assert.equal(statsCount(), 2);
  assert.deepEqual(card._entityEl.children.map((o) => o.value), ["person.a", "person.b"]);
});

test("overlapping loads: the older answer is discarded, the newer one shown", async () => {
  const antworten = [];
  const { card, aufrufe } = zonenKarte({
    month: MONAT,
    callWS: (msg) => {
      if (msg.type === "localtrack/stats") return Promise.resolve({ tracked: ["person.a"] });
      const d = offen();
      antworten.push(d);
      return d.promise;
    },
  });
  await ruhe();
  assert.equal(antworten.length, 1);
  card._shiftMonth(1);           // April, while March is still loading
  await ruhe();
  assert.equal(antworten.length, 1, "second load must wait for the first");
  const alt = ergebnis(1111);
  antworten[0].resolve(alt);
  await ruhe();
  assert.notEqual(card._result, alt, "stale March answer reached the screen");
  assert.equal(antworten.length, 2, "pending load did not run");
  const zoneCalls = aufrufe.filter((m) => m.type === "localtrack/zone_time");
  assert.equal(zoneCalls[1].start, "2026-04-01T00:00:00");
  const neu = ergebnis(7200);
  antworten[1].resolve(neu);
  await ruhe();
  assert.equal(card._result, neu);
  assert.equal(card._labelEl.textContent, "April 2026");
  assert.equal(card._statusEl.hidden, true);
});

test("rejected callWS: error status with the reason, table hidden", async () => {
  const { card, texte } = zonenKarte({
    month: MONAT,
    callWS: (msg) => (msg.type === "localtrack/stats"
      ? Promise.resolve({ tracked: [] })
      : Promise.reject({ code: "timeout", message: "no answer" })),
  });
  await ruhe();
  assert.equal(card._statusEl.textContent, texte.ladefehler_grund.replace("{grund}", "no answer"));
  assert.equal(card._statusEl.hidden, false);
  assert.equal(card._tableEl.hidden, true);
  assert.equal(card._loading, false);
});

test("rejected callWS with unknown_command / not_found: the setup hints", async () => {
  for (const [code, key] of [["unknown_command", "veraltet"], ["not_found", "nicht_eingerichtet"]]) {
    const { card, texte } = zonenKarte({
      month: MONAT,
      callWS: (msg) => (msg.type === "localtrack/stats" ? Promise.resolve({ tracked: [] }) : Promise.reject({ code })),
    });
    await ruhe();
    assert.equal(card._statusEl.textContent, texte[key], code);
  }
});

test("zone_time request: month range and default thresholds", async () => {
  const { aufrufe } = zonenKarte({
    month: { year: 2026, month: 10 },
    callWS: (msg) => Promise.resolve(msg.type === "localtrack/stats" ? { tracked: [] } : ergebnis(60)),
  });
  await ruhe();
  const call = aufrufe.find((m) => m.type === "localtrack/zone_time");
  assert.equal(call.entity_id, "person.a");
  assert.equal(call.start, "2026-10-01T00:00:00");
  assert.equal(call.end, "2026-10-31T23:59:59");
  assert.equal(call.min_visit_s, 300);
  assert.equal(call.max_gap_s, 1800);
  assert.equal(call.radius, 50);
});
