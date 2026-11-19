"use strict";

// #1304 M21: how long the bundle's top level takes to run, section by
// section, from its first to its last statement. Compiling is excluded
// (the script is compiled before the first mark), as in the M6 browser
// measurement. Every sample is a fresh Node process, so lazily compiled
// functions are cold like on a frontend start.
//
//   node tests/bank-auswertung.cjs [samples] [file]
//
// Prints the median and p95 per section and of the whole top level, in ms.
// Not a test (`node --test tests/*.test.js` does not pick it up).

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { execFileSync } = require("node:child_process");

const DEFAULT_FILE = path.join(__dirname, "..", "dist", "localtrack-cards.js");

/** Section starts: [name, regex for the first line of the section]. A section
 *  runs up to the next start; the last one up to the end of the file. */
const SECTIONS = [
  ["shared-ui", /^\/\* BEGIN BUSCH SHARED UI/],
  ["kopf+banner", /^\/\* END BUSCH SHARED UI \*\//],
  ["leaflet-js", /^(function localtrackLeaflet\(\)|\/\* BEGIN VENDOR leaflet 1)/],
  ["leaflet-css (Vendor)", /^\/\* BEGIN VENDOR leaflet-css/],
  ["sprachhelfer", /^\/\* END VENDOR leaflet-css \*\//],
  ["BROWSER_LANG (navigator)", /^const BROWSER_LANG =/],
  ["fillText", /^\/\*\* Fill `\{name\}` placeholders/],
  ["schema timeline", /^const SCHEMA_LOCALTRACK_TIMELINE_CARD = /],
  ["texte timeline", /^const TEXTE_LOCALTRACK_TIMELINE_CARD = /],
  ["helfer timeline", /^function loadLeaflet\(\)/],
  ["vorschau+styles", /^\/\*\* Sample day of the timeline preview/],
  ["class timeline", /^class LocaltrackTimelineCard /],
  ["editor-klassen", /^function sameEditorConfig\(/],
  ["define+customCards timeline", /^customElements\.define\("localtrack-timeline-card",/],
  ["helfer+schema+texte zonenzeit", /^function formatHoursMinutes\(/],
  ["styles zonenzeit", /^const ZONE_TIME_STYLES = /],
  ["class zonenzeit+editor", /^class LocaltrackZoneTimeCard /],
  ["define+customCards zonenzeit", /^customElements\.define\("localtrack-zone-time-card",/],
];

function instrument(source) {
  const lines = source.split("\n");
  const out = [];
  const seen = [];
  for (const line of lines) {
    const hit = SECTIONS.find(([, re]) => re.test(line));
    if (hit) { out.push(`__mark(${JSON.stringify(hit[0])});`); seen.push(hit[0]); }
    out.push(line);
  }
  out.push('__mark("ende");');
  if (!seen.length) throw new Error("no section start found");
  return out.join("\n");
}

/** One cold run in this process: shims, compile, run, return section times. */
function child(file) {
  const g = globalThis;
  class FakeElement {
    constructor() { this.style = {}; this.dataset = {}; }
    setAttribute() {} appendChild(n) { return n; } addEventListener() {}
  }
  g.window = g;
  g.HTMLElement = class extends FakeElement {};
  g.customElements = { define() {}, get() {} };
  // Enough for the Leaflet UMD of an older bundle that runs it on load.
  g.devicePixelRatio = 1;
  g.document = { createElement: () => new FakeElement(), head: new FakeElement(), getElementById: () => null,
    documentElement: { style: {} }, addEventListener() {} };
  const marks = [];
  g.__mark = (name) => marks.push([name, performance.now()]);
  const quiet = console.info;
  // DevTools (and Playwright) capture a stack trace for every console call;
  // the first one makes V8 collect the source positions of the calling
  // function. BANK_STACK=0 measures without it.
  let bannerMs = 0;
  console.info = process.env.BANK_STACK === "0" ? () => {} : () => {
    const start = performance.now();
    void new Error().stack;
    bannerMs += performance.now() - start;
  };
  const script = new vm.Script(instrument(fs.readFileSync(file, "utf8")), { filename: file });
  script.runInThisContext();
  const result = {};
  for (let i = 0; i < marks.length - 1; i += 1) result[marks[i][0]] = marks[i + 1][1] - marks[i][1];
  result.gesamt = marks[marks.length - 1][1] - marks[0][1];
  result["davon Banner-Stack"] = bannerMs;
  // A deferred banner runs after the last statement, in a later task.
  return new Promise((resolve) => setTimeout(resolve, 10)).then(() => {
    console.info = quiet;
    result["Banner-Stack nach Ende"] = bannerMs - result["davon Banner-Stack"];
    return result;
  });
}

function quantile(sorted, q) {
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
}

function main() {
  if (process.argv[2] === "--child") {
    child(process.argv[3]).then((result) => process.stdout.write(JSON.stringify(result)));
    return;
  }
  const samples = Number(process.argv[2]) || 30;
  const file = path.resolve(process.argv[3] || DEFAULT_FILE);
  const runs = [];
  for (let i = 0; i < samples; i += 1) {
    runs.push(JSON.parse(execFileSync(process.execPath, [__filename, "--child", file], { encoding: "utf8" })));
  }
  const names = [...SECTIONS.map(([name]) => name), "gesamt", "davon Banner-Stack", "Banner-Stack nach Ende"];
  console.log(`${path.basename(file)}: ${samples} cold runs, ms`);
  for (const name of names) {
    const values = runs.map((run) => run[name]).filter((v) => v !== undefined).sort((a, b) => a - b);
    if (!values.length) { console.log(`${name.padEnd(32)} (fehlt)`); continue; }
    console.log(`${name.padEnd(32)} median ${quantile(values, 0.5).toFixed(3)}  p95 ${quantile(values, 0.95).toFixed(3)}`);
  }
}

main();
