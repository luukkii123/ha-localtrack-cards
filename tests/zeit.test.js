"use strict";

// #1264 M20 (Buschcheck D5): month and day bounds across daylight saving
// time, and the hours:minutes format of the zone-time card.
process.env.TZ = "Europe/Berlin";

const test = require("node:test");
const assert = require("node:assert/strict");
const { ladeKarte } = require("./laden.js");

const { monthRange, localDayBounds, formatHoursMinutes } =
  ladeKarte(["monthRange", "localDayBounds", "formatHoursMinutes"]);

const HOUR = 3600 * 1000;

test("time zone of the test run is Europe/Berlin", () => {
  assert.equal(new Date(2026, 0, 1).getTimezoneOffset(), -60);
  assert.equal(new Date(2026, 6, 1).getTimezoneOffset(), -120);
});

test("monthRange: March and October (DST months) keep local wall-clock bounds", () => {
  assert.deepEqual({ ...monthRange(2026, 3) }, { start: "2026-03-01T00:00:00", end: "2026-03-31T23:59:59", days: 31 });
  assert.deepEqual({ ...monthRange(2026, 10) }, { start: "2026-10-01T00:00:00", end: "2026-10-31T23:59:59", days: 31 });
});

test("monthRange: February, leap year, December", () => {
  assert.equal(monthRange(2026, 2).days, 28);
  assert.equal(monthRange(2028, 2).end, "2028-02-29T23:59:59");
  assert.deepEqual({ ...monthRange(2026, 12) }, { start: "2026-12-01T00:00:00", end: "2026-12-31T23:59:59", days: 31 });
  assert.equal(monthRange(2026, 4).days, 30);
});

test("localDayBounds: spring-forward day in March is 23 hours long", () => {
  const { start, end } = localDayBounds("2026-03-29");
  assert.equal(start.toISOString(), "2026-03-28T23:00:00.000Z");
  assert.equal(end.toISOString(), "2026-03-29T21:59:59.999Z");
  assert.equal(end - start + 1, 23 * HOUR);
});

test("localDayBounds: fall-back day in October is 25 hours long", () => {
  const { start, end } = localDayBounds("2026-10-25");
  assert.equal(start.toISOString(), "2026-10-24T22:00:00.000Z");
  assert.equal(end.toISOString(), "2026-10-25T22:59:59.999Z");
  assert.equal(end - start + 1, 25 * HOUR);
});

test("localDayBounds: an ordinary day is 24 hours and starts at local midnight", () => {
  const { start, end } = localDayBounds("2026-07-14");
  assert.equal(start.getHours(), 0);
  assert.equal(start.getDate(), 14);
  assert.equal(end - start + 1, 24 * HOUR);
});

test("formatHoursMinutes: zero, empty and under 30 s show the placeholder", () => {
  for (const value of [0, undefined, null, NaN, 29]) {
    assert.equal(formatHoursMinutes(value, "—"), "—", String(value));
  }
});

test("formatHoursMinutes: rounds to the minute with two-digit minutes", () => {
  assert.equal(formatHoursMinutes(30, "—"), "0:01");
  assert.equal(formatHoursMinutes(8 * 3600 + 12 * 60, "—"), "8:12");
  assert.equal(formatHoursMinutes(3600 + 5 * 60 + 29, "—"), "1:05");
  assert.equal(formatHoursMinutes(3600 + 29, "—"), "1:00");
});

test("formatHoursMinutes: more than 24 h keeps counting hours", () => {
  assert.equal(formatHoursMinutes(24 * 3600, "—"), "24:00");
  assert.equal(formatHoursMinutes(25 * 3600 + 3 * 60, "—"), "25:03");
  assert.equal(formatHoursMinutes(31 * 24 * 3600, "—"), "744:00");
});
