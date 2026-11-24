"use strict";

// #1304 M35 (Buschcheck N10, P13): the timeline's live refresh asks only for
// the points after the last known one (`start` = its timestamp), appends them
// with `addLatLng` and segments only the tail again. A full fetch stays for a
// new day, a gap (last load too old) and a reached `max_points`. Only a
// position change triggers it (a battery update does not), a hidden tab does
// not load (it catches up when shown again), and a live refresh never moves
// the map (`fitBounds`, `panTo`).
const test = require("node:test");
const assert = require("node:assert/strict");
const { createClock, createHass } = require("./_testkit.cjs");
const { ladeKarte, feuere, einhaengen, ruhe } = require("./laden.js");

const DAY_START = 1_799_971_200; // 2027-01-15T00:00:00Z, the clock's day (UTC in the container)
const NOW = 1_800_000_000;       // 08:00:00Z, createClock's start

/** Leaflet stand-in that records what the card does with the map. */
function leaflet() {
  const log = { fitBounds: 0, panTo: 0, addLatLng: 0, polylines: [], pins: [], removed: [] };
  const group = () => {
    const layers = new Set();
    return {
      layers,
      addTo() { return this; },
      clearLayers() { layers.clear(); },
      removeLayer(layer) { layers.delete(layer); log.removed.push(layer); return this; },
      addLayer(layer) { layers.add(layer); return this; },
    };
  };
  const marker = (kind) => (latlng, options) => {
    const m = {
      kind, latlng, options,
      addTo(target) { target.layers?.add(m); return m; },
      setLatLng(next) { m.latlng = next; return m; },
    };
    if (kind === "pin") log.pins.push(m);
    return m;
  };
  return {
    log,
    Icon: { Default: { mergeOptions() {} } },
    map(el) {
      return {
        el, remove() {}, setView() {}, removeLayer() {}, invalidateSize() {},
        fitBounds() { log.fitBounds += 1; }, panTo() { log.panTo += 1; },
        getBounds: () => ({ contains: () => false }),
      };
    },
    tileLayer: () => ({ addTo() { return this; } }),
    layerGroup: group,
    polyline(latlngs) {
      const line = {
        latlngs: latlngs.slice(),
        addTo() { return line; },
        addLatLng(next) { line.latlngs.push(next); log.addLatLng += 1; return line; },
      };
      log.polylines.push(line);
      return line;
    },
    circleMarker: marker("circle"),
    marker: marker("pin"),
    divIcon: (options) => options,
    latLngBounds: () => ({ pad() { return this; } }),
  };
}

/** Points every `step` s from `from` to `to` (inclusive) at a place, ±30 m jitter. */
function stay(from, to, lat, lon, step = 20) {
  const out = [];
  for (let ts = from; ts <= to; ts += step) {
    out.push({ ts, lat: lat + ((ts / step) % 3) * 0.0001, lon: lon + ((ts / step) % 2) * 0.0001, accuracy: 10 });
  }
  return out;
}

/** A straight drive between two places. */
function drive(from, to, a, b, step = 20) {
  const out = [];
  for (let ts = from; ts <= to; ts += step) {
    const f = (ts - from) / Math.max(1, to - from);
    out.push({ ts, lat: a[0] + (b[0] - a[0]) * f, lon: a[1] + (b[1] - a[1]) * f, accuracy: 10 });
  }
  return out;
}

const HOME = [50.0, 8.0];
const WORK = [50.05, 8.05];
const SHOP = [50.02, 8.1];

/** The day until 08:00: home, drive, work (the trailing stay is still open). */
function morning() {
  return [
    ...stay(DAY_START, DAY_START + 6 * 3600, ...HOME),
    ...drive(DAY_START + 6 * 3600 + 20, DAY_START + 6.5 * 3600, HOME, WORK),
    ...stay(DAY_START + 6.5 * 3600 + 20, NOW, ...WORK),
  ];
}

/** The integration's `localtrack/history`: inclusive range, Douglas-Peucker
 *  stand-in (every n-th point) above `max_points`. */
function server(store) {
  return (msg) => {
    const start = Date.parse(msg.start) / 1000;
    const end = Date.parse(msg.end) / 1000;
    let points = store.filter((p) => p.ts >= start && p.ts <= end);
    const total = points.length;
    if (total > msg.max_points) {
      const every = Math.ceil(total / msg.max_points);
      points = points.filter((_, i) => i % every === 0);
    }
    return { entity_id: msg.entity_id, points: points.map((p) => ({ ...p })), total, simplified: total !== points.length };
  };
}

/** Timeline card on the kit clock with a recording Leaflet and a document whose
 *  visibility the test controls. */
async function karte({ store = morning(), config = {} } = {}) {
  const clock = createClock(NOW * 1000);
  const k = ladeKarte(["LocaltrackTimelineCard", "computeSegments"]);
  const doc = k.kontext.document;
  const listeners = {};
  doc.hidden = false;
  doc.addEventListener = (type, fn) => (listeners[type] ||= new Set()).add(fn);
  doc.removeEventListener = (type, fn) => listeners[type]?.delete(fn);
  const setHidden = (hidden) => {
    doc.hidden = hidden;
    for (const fn of [...(listeners.visibilitychange || [])]) fn();
  };
  Object.assign(k.kontext, {
    setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout, Date: clock.Date,
    ResizeObserver: class { observe() {} disconnect() {} },
  });
  const L = leaflet();
  k.kontext.L = L;
  const last = store[store.length - 1];
  const ha = createHass({
    clock,
    states: { "person.a": { state: "not_home", attributes: { friendly_name: "A", latitude: last.lat, longitude: last.lon, battery_level: 80 } } },
  });
  ha.respond("localtrack/history", server(store));
  const card = new k.LocaltrackTimelineCard();
  einhaengen(card);
  card.setConfig({ entity: "person.a", ...config });
  card.hass = ha.hass;
  await clock.advance(0);
  await ruhe();
  return { k, card, clock, ha, L, store, setHidden, listeners };
}

/** The tracker reports new points: they go to the store, the state moves. */
async function bewege(ctx, points) {
  ctx.store.push(...points);
  const last = points[points.length - 1];
  ctx.ha.patchState("person.a", {
    last_updated: new ctx.clock.Date().toISOString(),
    attributes: { latitude: last.lat, longitude: last.lon },
  });
  ctx.card.hass = ctx.ha.hass;
}

/** History calls in order, with the bytes of each answer. */
function abrufe(ha) {
  return ha.log.filter((e) => e.type === "localtrack/history").map((e) => e.message);
}

const startOf = (msg) => Date.parse(msg.start) / 1000;

test("three position updates: one full fetch, then two appending fetches from the last point", async () => {
  const ctx = await karte();
  const { card, clock, ha, L, store } = ctx;
  const fullBytes = ha.stats.bytesIn["localtrack/history"];
  assert.equal(card._points.length, store.length);
  assert.equal(L.log.fitBounds, 1, "first load fits the day");
  const panBefore = L.log.panTo;

  // Update 2: the person stays at work a few minutes more, then leaves.
  await clock.advance(5 * 60 * 1000);
  await bewege(ctx, [
    ...stay(NOW + 20, NOW + 5 * 60, ...WORK),
  ]);
  await clock.advance(30000);
  await ruhe();
  const afterSecond = ha.stats.bytesIn["localtrack/history"];

  // Update 3: drive to the shop and stop there.
  await clock.advance(9 * 60 * 1000);
  await bewege(ctx, [
    ...drive(NOW + 5 * 60 + 20, NOW + 10 * 60, WORK, SHOP),
    ...stay(NOW + 10 * 60 + 20, NOW + 14 * 60, ...SHOP),
  ]);
  await clock.advance(30000);
  await ruhe();

  const calls = abrufe(ha);
  assert.equal(calls.length, 3, "one fetch per position update");
  assert.equal(startOf(calls[0]), DAY_START, "first fetch: the whole day");
  assert.ok(startOf(calls[1]) > DAY_START && startOf(calls[1]) <= NOW, "second fetch starts at the last known point");
  assert.ok(startOf(calls[2]) > startOf(calls[1]), "third fetch starts at the newer last point");
  assert.equal(startOf(calls[2]), NOW + 5 * 60, "start is the last point's timestamp");
  assert.equal(calls[1].end, calls[0].end, "the end of the day stays");

  assert.equal(L.log.polylines.length, 1, "the line is not rebuilt");
  assert.equal(L.log.polylines[0].latlngs.length, store.length, "every new point appended once");
  assert.equal(card._points.length, store.length, "no duplicate of the boundary point");
  assert.equal(new Set(card._points.map((p) => p.ts)).size, store.length);
  assert.equal(L.log.fitBounds, 1, "a live refresh never fits the map");
  assert.equal(L.log.panTo, panBefore, "a live refresh never pans the map");

  const secondBytes = afterSecond - fullBytes;
  const thirdBytes = ha.stats.bytesIn["localtrack/history"] - afterSecond;
  console.log(`# M35 bytes: full day ${fullBytes} B (${store.length} points at the end), live ${secondBytes} B, live ${thirdBytes} B`);
  assert.ok(secondBytes <= 5000, `live answer ${secondBytes} B > 5 kB`);
  assert.ok(thirdBytes <= 5000, `live answer ${thirdBytes} B > 5 kB`);
});

test("appended segments equal the segments of a full fetch, pins follow the tail", async () => {
  const ctx = await karte({ config: { min_stay_minutes: 5 } });
  const { card, clock, k, L, store } = ctx;
  await clock.advance(5 * 60 * 1000);
  await bewege(ctx, stay(NOW + 20, NOW + 5 * 60, ...WORK));
  await clock.advance(30000);
  await ruhe();
  await clock.advance(9 * 60 * 1000);
  await bewege(ctx, [
    ...drive(NOW + 5 * 60 + 20, NOW + 7 * 60, WORK, SHOP),
    ...stay(NOW + 7 * 60 + 20, NOW + 14 * 60, ...SHOP),
  ]);
  await clock.advance(30000);
  await ruhe();

  const full = k.computeSegments(store, 150, 5);
  assert.deepEqual(JSON.parse(JSON.stringify(card._segments)), JSON.parse(JSON.stringify(full)));
  assert.equal(full.map((s) => s.kind).join(), "stay,move,stay,move,stay", "fixture crosses a stay boundary");
  const stays = full.filter((s) => s.kind === "stay");
  const pinsOnMap = L.log.pins.filter((p) => card._markerLayer.layers.has(p));
  assert.equal(pinsOnMap.length, stays.length, "one pin per stay");
  assert.equal(pinsOnMap.map((p) => p.options.icon.html.match(/>(\d+)</)[1]).join(), stays.map((_, i) => String(i + 1)).join());
});

test("incremental segmentation equals a full run for every split point", () => {
  const { computeSegments, segmentTrack } = ladeKarte(["computeSegments", "segmentTrack"]);
  const tracks = [
    morning().filter((_, i) => i % 7 === 0).concat(drive(NOW + 20, NOW + 900, WORK, SHOP, 60), stay(NOW + 960, NOW + 3000, ...SHOP, 60)),
    [...stay(0, 1200, ...HOME, 30), ...drive(1230, 1500, HOME, WORK, 30), ...stay(1530, 1600, ...WORK, 30),
     ...drive(1630, 2000, WORK, SHOP, 30), ...stay(2030, 4000, ...SHOP, 30), ...drive(4030, 4200, SHOP, HOME, 30)],
  ];
  for (const track of tracks) {
    const full = JSON.stringify(computeSegments(track, 150, 10));
    for (let split = 1; split < track.length; split += 1) {
      const head = segmentTrack(track.slice(0, split), 150, 10);
      const tail = segmentTrack(track, 150, 10, head);
      assert.equal(JSON.stringify(tail.segments), full, `split at ${split}`);
    }
  }
});

test("a battery update without a position change does not fetch", async () => {
  const ctx = await karte();
  const { card, clock, ha } = ctx;
  await clock.advance(1000);
  ha.patchState("person.a", { last_updated: new clock.Date().toISOString(), attributes: { battery_level: 79 } });
  card.hass = ha.hass;
  await clock.advance(60000);
  await ruhe();
  assert.equal(abrufe(ha).length, 1, "only the first load");
});

test("hidden tab: no fetch while hidden, one appending fetch when shown again", async () => {
  const ctx = await karte();
  const { clock, ha, setHidden, listeners } = ctx;
  setHidden(true);
  await clock.advance(60000);
  await bewege(ctx, stay(NOW + 20, NOW + 60, ...WORK));
  await clock.advance(60000);
  await ruhe();
  assert.equal(abrufe(ha).length, 1, "no fetch in a hidden tab");
  setHidden(false);
  await clock.advance(0);
  await ruhe();
  const calls = abrufe(ha);
  assert.equal(calls.length, 2, "caught up once when shown");
  assert.ok(startOf(calls[1]) > DAY_START, "the catch-up appends");
  assert.equal(listeners.visibilitychange.size, 0, "listener removed after the catch-up");
  setHidden(true);
  setHidden(false);
  await clock.advance(0);
  assert.equal(abrufe(ha).length, 2, "showing the tab again without news loads nothing");
});

test("full fetch again after a gap, after a reached max_points and on another day", async () => {
  // Gap: the last load is older than 15 min (reconnect, imports).
  let ctx = await karte();
  await ctx.clock.advance(20 * 60 * 1000);
  await bewege(ctx, stay(NOW + 20, NOW + 60, ...WORK));
  await ctx.clock.advance(30000);
  await ruhe();
  let calls = abrufe(ctx.ha);
  assert.equal(calls.length, 2);
  assert.equal(startOf(calls[1]), DAY_START, "after a gap the whole day");
  assert.equal(ctx.L.log.fitBounds, 1, "no fitBounds on the live full fetch either");

  // max_points: the day already fills max_points, the server thins it out.
  ctx = await karte({ config: { max_points: 600 } });
  assert.equal(ctx.card._points.length < ctx.store.length, true, "server simplified");
  await ctx.clock.advance(60000);
  await bewege(ctx, stay(NOW + 20, NOW + 60, ...WORK));
  await ctx.clock.advance(30000);
  await ruhe();
  calls = abrufe(ctx.ha);
  assert.equal(calls.length, 2);
  assert.equal(startOf(calls[1]), DAY_START, "simplified day: the whole day again");

  // Appending would pass max_points: the whole day again (the server thins).
  ctx = await karte({ config: { max_points: morning().length + 2 } });
  await ctx.clock.advance(60000);
  await bewege(ctx, stay(NOW + 20, NOW + 100, ...WORK));
  await ctx.clock.advance(30000);
  await ruhe();
  calls = abrufe(ctx.ha);
  assert.equal(startOf(calls[calls.length - 1]), DAY_START, "over max_points: the whole day");
  assert.ok(ctx.card._points.length <= morning().length + 2, "no more than max_points shown");

  // Another day picked and today picked again: the whole day.
  ctx = await karte();
  ctx.card._dateEl.value = "2027-01-14";
  feuere(ctx.card._dateEl, "change");
  await ctx.clock.advance(0);
  await ruhe();
  ctx.card._dateEl.value = "2027-01-15";
  feuere(ctx.card._dateEl, "change");
  await ctx.clock.advance(0);
  await ruhe();
  await bewege(ctx, stay(NOW + 20, NOW + 60, ...WORK));
  await ctx.clock.advance(30000);
  await ruhe();
  calls = abrufe(ctx.ha);
  assert.equal(startOf(calls[2]), DAY_START, "today again: the whole day");
  assert.ok(startOf(calls[3]) > DAY_START, "then appending");
});
