"use strict";

// M26 (Buschcheck W2, E6): the obvious contrast cases, computed from the CSS
// of the card against the background it sits on, in the light and the dark
// theme of the render harness (hacs docs/render/regeln.py, THEMA_CSS). WCAG
// 2.2 AA 1.4.3: 4.5:1 for normal text. The measured run (render.py,
// zonetime.py: kontrast/touch in report.json) is the real proof; this test
// keeps the three cases from coming back.

const test = require("node:test");
const assert = require("node:assert/strict");
const { quelle } = require("./laden");

const THEMEN = {
  light: { "--primary-color": "#03a9f4", "--primary-text-color": "#212121", "--secondary-text-color": "#727272",
    "--disabled-text-color": "#bdbdbd", "--card-background-color": "#ffffff", "--secondary-background-color": "#e5e5e5",
    "--text-primary-color": "#ffffff" },
  dark: { "--primary-color": "#03a9f4", "--primary-text-color": "#e1e1e1", "--secondary-text-color": "#9b9b9b",
    "--disabled-text-color": "#6f6f6f", "--card-background-color": "#1c1c1c", "--secondary-background-color": "#202020",
    "--text-primary-color": "#212121" },
};

const KARTE = quelle()
  .replace(/\/\* BEGIN BUSCH SHARED UI[\s\S]*?\/\* END BUSCH SHARED UI \*\//, "")
  .replace(/\/\* BEGIN VENDOR ([\w-]+)[\s\S]*?\/\* END VENDOR \1 \*\//g, "")
  // ${…} interpolations (BuschUI.tokens) carry braces: one token stand-in, so CSS blocks parse.
  .replace(/\$\{[^{}]*\}/g, "var(--busch-token)");

const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

/** A colour value of the card with var() resolved against `thema`; supports color-mix in srgb. */
function farbe(wert, thema) {
  let v = wert.trim();
  for (let alt = ""; alt !== v;) {
    alt = v;
    v = v.replace(/var\(\s*(--[\w-]+)\s*(?:,\s*([^()]*))?\)/g, (_, name, fb) => thema[name] ?? (fb || "").trim());
  }
  const mix = v.match(/^color-mix\(in srgb,\s*(#[0-9a-f]{6})\s+(\d+)%,\s*(#[0-9a-f]{6})\)$/i);
  if (mix) {
    const p = Number(mix[2]) / 100;
    const [a, b] = [rgb(mix[1]), rgb(mix[3])];
    return a.map((x, i) => Math.round(x * p + b[i] * (1 - p)));
  }
  assert.match(v, /^#[0-9a-f]{6}$/i, `unresolved colour ${wert} -> ${v}`);
  return rgb(v);
}

function kontrast(a, b) {
  const lum = (c) => {
    const [r, g, bl] = c.map((x) => { const s = x / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; });
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hell, dunkel] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hell + 0.05) / (dunkel + 0.05);
}

/** Value of `prop` in the CSS rule whose selector ends with `selektor`. */
function regel(selektor, prop) {
  for (const block of KARTE.matchAll(/([^{}]*)\{([^{}]*)\}/g)) {
    if (block[1].trim().split("\n").pop().trim() !== selektor) continue;
    const m = block[2].match(new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`));
    if (m) return m[1].trim();
  }
  throw new Error(`no ${prop} in ${selektor}`);
}

/** Inline style property of the stay pin (Leaflet divIcon). */
function nadel(prop) {
  const html = KARTE.match(/html: `<div style="([^"]*)">var\(--busch-token\)<\/div>`/);
  assert.ok(html, "stay pin markup");
  const m = html[1].match(new RegExp(`(?:^|;)${prop}:([^;]+)`));
  return m[1];
}

const FAELLE = [
  ["stay pin number on its fill", () => nadel("color"), () => nadel("background")],
  ["segment meta (duration, km) on the row", () => regel(".segment .meta", "color"), () => regel(".segment", "background")],
  ["zone time: empty day row on the card", () => regel("tr.empty td", "color"), () => "var(--card-background-color)"],
  // #1318 image review: the loading hint over the old map has its own opaque surface.
  ["timeline: stale loading hint on its surface", () => "var(--primary-text-color)", () => regel(".map-overlay.stale", "background")],
];

for (const [name, vorne, hinten] of FAELLE) {
  for (const [thema, werte] of Object.entries(THEMEN)) {
    test(`${name}: at least 4.5:1 (${thema})`, () => {
      const wert = kontrast(farbe(vorne(), werte), farbe(hinten(), werte));
      assert.ok(wert >= 4.5, `${wert.toFixed(2)}:1`);
    });
  }
}

// M79 (#1320, user decision 19.11.): coloured symbols are non-text graphics (WCAG 1.4.11) and reach 3:1 on their
// surface, also next to a text. The stay/move dot of a timeline segment sits on the row and on its hover surface.
const SYMBOL_THEMEN = {
  light: { ...THEMEN.light, "--success-color": "#43a047", "--divider-color": "#e0e0e0" },
  dark: { ...THEMEN.dark, "--success-color": "#43a047", "--divider-color": "#474747" },
};
for (const punkt of [".segment.stay .dot", ".segment.move .dot"]) {
  for (const [thema, werte] of Object.entries(SYMBOL_THEMEN)) {
    test(`M79 timeline dot ${punkt}: at least 3:1 on the row and on hover (${thema})`, () => {
      const vorne = farbe(regel(punkt, "background"), werte);
      for (const flaeche of [".segment", ".segment:hover"]) {
        const wert = kontrast(vorne, farbe(regel(flaeche, "background"), werte));
        assert.ok(wert >= 3, `${flaeche} ${wert.toFixed(2)}:1`);
      }
    });
  }
}

// #1320 (Etappe I, Kontrast-Rest, user decision: no exception for graphics): every operated part of the time slider
// (thumb, track, Firefox progress) and every information-carrying map graphic of the card's own (start, end and current
// point, preview route and stay dots, zone-time bar) reaches 3:1 on the card surface in light and dark (WCAG 1.4.11).
// The map tiles are not ours: the lines are measured by their own colour against the card, not against a tile.
const GRAFIK_THEMEN = {
  light: { ...SYMBOL_THEMEN.light, "--error-color": "#db4437", "--warning-color": "#ffa600" },
  dark: { ...SYMBOL_THEMEN.dark, "--error-color": "#db4437", "--warning-color": "#ffa600" },
};
const R = '.scrubber input[type="range"]';
/** Inline value assigned in the card code, e.g. `route.style.stroke = "…"`. */
function zuweisung(ziel) {
  const m = KARTE.match(new RegExp(ziel.replace(/[.]/g, "\\.") + ' = "([^"]+)"'));
  assert.ok(m, ziel);
  return m[1];
}
const GRAFIK = [
  ["slider thumb (WebKit)", () => regel(`${R}::-webkit-slider-thumb`, "background")],
  ["slider thumb (Firefox)", () => regel(`${R}::-moz-range-thumb`, "background")],
  ["slider track (WebKit)", () => regel(`${R}::-webkit-slider-runnable-track`, "background")],
  ["slider track (Firefox)", () => regel(`${R}::-moz-range-track`, "background")],
  ["slider progress (Firefox)", () => regel(`${R}::-moz-range-progress`, "background")],
  ["map start point", () => regel(".map path.lt-start", "fill")],
  ["map current point", () => regel(".map path.lt-current", "fill")],
  ["map route and end point", () => "var(--error-color, #e53935)"],
  ["preview route", () => zuweisung("route.style.stroke")],
  ["preview stay dot", () => zuweisung("dot.style.fill")],
  ["zone time bar", () => regel(".fill", "background")],
];
for (const [name, vorne] of GRAFIK) {
  for (const [thema, werte] of Object.entries(GRAFIK_THEMEN)) {
    test(`#1320 ${name}: at least 3:1 on the card (${thema})`, () => {
      const wert = kontrast(farbe(vorne(), werte), farbe("var(--card-background-color)", werte));
      assert.ok(wert >= 3, `${wert.toFixed(2)}:1`);
    });
  }
}
test("#1320 the drawn route is opaque and the map points carry their class, the stale state does not dim the slider", () => {
  assert.match(KARTE, /L\.polyline\(latLngs, \{ color: routeColor, weight: 4, opacity: 1 \}\)/);
  assert.match(KARTE, /L\.circleMarker\(latLngs\[0\], \{[^}]*className: "lt-start"/);
  assert.match(KARTE, /this\._currentMarker = L\.circleMarker\(\[point\.lat, point\.lon\], \{[^}]*className: "lt-current"/);
  assert.doesNotMatch(KARTE, /ha-card\.stale \.scrubber\s*[,{]/, "the slider keeps its contrast while old content is shown");
  assert.equal(regel("ha-card.stale .segments, ha-card.stale .scrub-head", "opacity"), "0.55");
});
