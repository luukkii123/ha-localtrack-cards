"use strict";

// #1304 M51 (Buschcheck P12): a finished day or month that was already seen
// comes from a module-wide LRU cache (at most 24 entries) without a request;
// the running day or month never does. While a new day or month loads, the
// old content stays, dimmed and marked `aria-busy`, instead of being cleared.
const test = require("node:test");
const assert = require("node:assert/strict");
const { createClock, createHass } = require("./_testkit.cjs");
const { ladeKarte, ruhe } = require("./laden.js");

const NOW = 1_800_000_000; // 2027-01-15T08:00:00Z

function leaflet() {
  const layer = () => ({ addTo() { return this; }, setLatLng() { return this; }, clearLayers() {}, removeLayer() {} });
  return {
    Icon: { Default: { mergeOptions() {} } },
    map: () => ({ remove() {}, setView() {}, removeLayer() {}, invalidateSize() {}, fitBounds() {}, panTo() {},
      getBounds: () => ({ contains: () => true }) }),
    tileLayer: layer, layerGroup: layer, polyline: layer, circleMarker: layer, marker: layer,
    divIcon: (options) => options, latLngBounds: () => ({ pad() { return this; } }),
  };
}

/** Bundle on the kit clock (timers and Date). */
function laden(namen) {
  const clock = createClock(NOW * 1000);
  const k = ladeKarte(namen);
  Object.assign(k.kontext, {
    setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout, Date: clock.Date,
    ResizeObserver: class { observe() {} disconnect() {} },
  });
  k.kontext.L = leaflet();
  return { k, clock };
}

/** One 20-minute stay on the requested day. */
function tag(msg) {
  const start = Date.parse(msg.start) / 1000 + 9 * 3600;
  const points = [];
  for (let t = 0; t <= 1200; t += 60) points.push({ ts: start + t, lat: 50, lon: 8 });
  return { points, total: points.length, simplified: false };
}

async function timeline() {
  const { k, clock } = laden(["LocaltrackTimelineCard"]);
  const ha = createHass({ clock, states: { "person.a": { attributes: { friendly_name: "A", latitude: 50, longitude: 8 } } } });
  ha.respond("localtrack/history", tag);
  const card = new k.LocaltrackTimelineCard();
  card.isConnected = true;
  card.setConfig({ entity: "person.a" });
  card.hass = ha.hass;
  await clock.advance(0);
  await ruhe();
  const waehle = async (day) => {
    card._dateEl.value = day;
    card._dateEl.listeners.change[0]();
    await clock.advance(0);
    await ruhe();
  };
  const tage = () => ha.log.filter((e) => e.type === "localtrack/history").map((e) => e.message.start);
  return { k, card, clock, ha, waehle, tage };
}

test("timeline: a past day seen before comes from the cache, today never", async () => {
  const { card, waehle, tage } = await timeline();
  assert.equal(tage().length, 1, "today loaded");
  await waehle("2027-01-14");
  await waehle("2027-01-13");
  await waehle("2027-01-14");
  assert.equal(tage().length, 3, "the 14th again without a request");
  assert.equal(card._points.length, 21, "cached day shown");
  assert.equal(card._segmentsEl.childElementCount, 1, "its stay listed");
  await waehle("2027-01-15");
  await waehle("2027-01-14");
  await waehle("2027-01-15");
  assert.equal(tage().length, 5, "today is fetched every time");
});

test("timeline: while a new day loads the old day stays dimmed with aria-busy", async () => {
  const { card, clock, ha, waehle } = await timeline();
  await waehle("2027-01-14");
  const rows = card._segmentsEl.children.slice();
  ha.behaveOnce("localtrack/history", { hang: true });
  await waehle("2027-01-12");
  assert.equal(card._segmentsEl.childElementCount, rows.length, "old rows kept");
  assert.equal(card._segmentsEl.children[0], rows[0], "same nodes, not rebuilt");
  assert.equal(card._segmentsEl.getAttribute("aria-busy"), "true");
  assert.equal(card._mapWrapEl.getAttribute("aria-busy"), "true");
  assert.ok(card._cardEl.classList.contains("stale"), "dimmed");
  assert.ok(card._overlayEl.classList.contains("stale"), "see-through loading hint");
  assert.equal(card._overlayEl.textContent, card._t.laden);
  assert.equal(card._scrubberEl.disabled, false, "scrubber not cleared");
  ha.release("localtrack/history");
  await clock.advance(0);
  await ruhe();
  assert.equal(card._segmentsEl.getAttribute("aria-busy"), "false");
  assert.ok(!card._cardEl.classList.contains("stale"));
  assert.ok(!card._overlayEl.classList.contains("stale"));
  assert.equal(card._overlayEl.textContent, "");
});

test("timeline: a failed load under old content clears it and shows the error", async () => {
  const { card, clock, ha, waehle } = await timeline();
  ha.behaveOnce("localtrack/history", { reject: { code: "boom", message: "kaputt" } });
  await waehle("2027-01-12");
  await clock.advance(0);
  assert.equal(card._segmentsEl.childElementCount, 0, "no rows of another day under the new date");
  assert.ok(!card._cardEl.classList.contains("stale"));
  assert.match(card._overlayEl.textContent, /kaputt/);
});

test("cache keeps at most 24 finished periods (LRU)", async () => {
  const { card, waehle, tage } = await timeline();
  const day = (n) => `2026-12-${String(n).padStart(2, "0")}`;
  for (let n = 1; n <= 30; n += 1) await waehle(day(n));
  assert.equal(tage().length, 31);
  await waehle(day(30));            // newest: cached
  await waehle(day(7));             // 7..30 are the last 24
  assert.equal(tage().length, 31, "the last 24 days come from the cache");
  await waehle(day(6));             // evicted
  assert.equal(tage().length, 32, "the 25th oldest was evicted");
  assert.ok(card._points.length > 0);
});

/* ── zone time ─────────────────────────────────────────────────────────── */

function monat(year, month) {
  const date = `${year}-${String(month).padStart(2, "0")}-02`;
  return { days: [{ date, net_s: 3600, gross_s: 3600 }], days_present: 1, total_net_s: 3600, total_gross_s: 3600, total_visits: 1 };
}

async function zonen() {
  const { k, clock } = laden(["LocaltrackZoneTimeCard", "TEXTE_LOCALTRACK_ZONE_TIME_CARD"]);
  const ha = createHass({
    clock,
    states: {
      "person.a": { attributes: { friendly_name: "A" } },
      "zone.work": { attributes: { friendly_name: "Work", latitude: 50, longitude: 8, radius: 50 } },
    },
  });
  ha.respond("localtrack/stats", { tracked: ["person.a"] });
  ha.respond("localtrack/zone_time", (msg) => monat(Number(msg.start.slice(0, 4)), Number(msg.start.slice(5, 7))));
  const card = new k.LocaltrackZoneTimeCard();
  card.setConfig({ entity: "person.a", zone: "zone.work" });
  card.hass = ha.hass;
  await clock.advance(0);
  await ruhe();
  const blaettern = async (delta) => {
    card._shiftMonth(delta);
    await clock.advance(0);
    await ruhe();
  };
  const monate = () => ha.log.filter((e) => e.type === "localtrack/zone_time").map((e) => e.message.start.slice(0, 7));
  return { k, card, clock, ha, blaettern, monate, texte: k.TEXTE_LOCALTRACK_ZONE_TIME_CARD.en.texte };
}

test("zone time: a past month seen before comes from the cache, the running month never", async () => {
  const { card, blaettern, monate } = await zonen();
  assert.deepEqual(monate().join(), "2027-01");
  await blaettern(-1);          // December
  await blaettern(-1);          // November
  await blaettern(1);           // December again: cache
  assert.equal(monate().join(), "2027-01,2026-12,2026-11");
  assert.equal(card._labelEl.textContent, "December 2026");
  assert.equal(card._bodyEl.childElementCount, 31, "cached month rendered");
  assert.ok(!card._tableEl.hidden);
  await blaettern(1);           // January: running, fetched again
  assert.equal(monate().join(), "2027-01,2026-12,2026-11,2027-01");
});

test("zone time: while a month loads the old table stays dimmed with aria-busy", async () => {
  const { card, clock, ha, blaettern, texte } = await zonen();
  const rows = card._bodyEl.children.slice();
  ha.behaveOnce("localtrack/zone_time", { hang: true });
  await blaettern(-1);
  assert.equal(card._labelEl.textContent, "December 2026", "the new month is named at once");
  assert.equal(card._tableEl.hidden, false, "table not hidden");
  assert.equal(card._bodyEl.children[0], rows[0], "old rows kept");
  assert.equal(card._tableEl.getAttribute("aria-busy"), "true");
  assert.equal(card._statusEl.hidden, true, "no status line above the table (no layout jump)");
  assert.equal(card._noteEl.textContent, texte.laden, "loading hint in the note line");
  ha.release("localtrack/zone_time");
  await clock.advance(0);
  await ruhe();
  assert.equal(card._tableEl.getAttribute("aria-busy"), "false");
  assert.notEqual(card._noteEl.textContent, texte.laden);
  assert.equal(card._bodyEl.childElementCount, 31);
});

test("zone time: first load without old content keeps the status line", async () => {
  const { k, clock } = laden(["LocaltrackZoneTimeCard", "TEXTE_LOCALTRACK_ZONE_TIME_CARD"]);
  const ha = createHass({
    clock,
    states: { "person.a": { attributes: {} }, "zone.work": { attributes: { friendly_name: "Work", latitude: 50, longitude: 8, radius: 50 } } },
  });
  ha.respond("localtrack/stats", { tracked: ["person.a"] });
  ha.behave("localtrack/zone_time", { hang: true });
  const card = new k.LocaltrackZoneTimeCard();
  card.setConfig({ entity: "person.a", zone: "zone.work" });
  card.hass = ha.hass;
  await clock.advance(0);
  assert.equal(card._statusEl.hidden, false);
  assert.equal(card._statusEl.textContent, k.TEXTE_LOCALTRACK_ZONE_TIME_CARD.en.texte.laden);
  assert.equal(card._tableEl.hidden, true);
});
