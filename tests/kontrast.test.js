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
