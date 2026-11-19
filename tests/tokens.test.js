"use strict";

// M63 (Buschcheck W13): type, radii and spacing come from tokens. No fixed
// `font-size: Npx` outside a var() fallback, no capitals by CSS in headings,
// one inner radius step (BuschUI.tokens.radiusInner) and the card radius with
// a 12 px fallback (was 8 px), spacing on --ha-space-*.
// Checked on the card code only: shared UI and Leaflet blocks are excluded.

const test = require("node:test");
const assert = require("node:assert/strict");
const { ladeKarte, quelle } = require("./laden");

const KARTE = quelle()
  .replace(/\/\* BEGIN BUSCH SHARED UI[\s\S]*?\/\* END BUSCH SHARED UI \*\//, "")
  .replace(/\/\* BEGIN VENDOR ([\w-]+)[\s\S]*?\/\* END VENDOR \1 \*\//g, "")
  // ${…} interpolations (BuschUI.tokens) carry braces: one token stand-in, so CSS blocks parse.
  .replace(/\$\{[^{}]*\}/g, "var(--busch-token)");

/** The value with every var(...) (nested) and ${...} interpolation removed. */
function ohneTokens(value) {
  let out = value.replace(/\$\{[^}]*\}/g, "");
  for (let alt = ""; alt !== out;) { alt = out; out = out.replace(/var\([^()]*\)/g, ""); }
  return out;
}

/** [selector, property, value] of every declaration in the card's CSS and inline styles. */
function deklarationen() {
  const out = [];
  for (const block of KARTE.matchAll(/([^{}]*)\{([^{}]*)\}/g)) {
    for (const decl of block[2].split(";")) {
      const m = decl.match(/^\s*([a-z-]+)\s*:\s*([\s\S]+?)\s*$/);
      if (m) out.push([block[1].trim().split("\n").pop().trim(), m[1], m[2]]);
    }
  }
  for (const style of KARTE.matchAll(/style="([^"]*)"/g)) {
    for (const decl of style[1].split(";")) {
      const m = decl.match(/^\s*([a-z-]+)\s*:\s*(.+?)\s*$/);
      if (m) out.push(["(inline)", m[1], m[2]]);
    }
  }
  return out;
}

test("every font-size of the card code is a token, no fixed px or em", () => {
  const fest = deklarationen().filter(([, p, v]) => p === "font-size" && /\d/.test(ohneTokens(v)));
  assert.deepEqual(fest, []);
});

test("no capitals by CSS and no letter-spacing in the card code", () => {
  assert.ok(!/text-transform\s*:\s*uppercase/.test(KARTE), "text-transform: uppercase");
  assert.ok(!/letter-spacing/.test(KARTE), "letter-spacing");
});

test("radii: inner step or card radius from tokens, 12 px card fallback, round shapes", () => {
  const fest = deklarationen().filter(([, p, v]) => p === "border-radius" && v !== "50%" && /\d/.test(ohneTokens(v)));
  assert.deepEqual(fest, []);
  assert.ok(!/--ha-card-border-radius,\s*8px/.test(KARTE), "card radius fallback 8 px");
});

test("margins, paddings and gaps come from --ha-space-* (slider thumb geometry aside)", () => {
  const fest = deklarationen().filter(([s, p, v]) => /^(margin|padding|gap)/.test(p)
    && !s.includes("::") && /[1-9]\d*px/.test(ohneTokens(v)));
  assert.deepEqual(fest, []);
});

test("zone-time column headings are in sentence case in both languages", () => {
  const k = ladeKarte(["TEXTE_LOCALTRACK_ZONE_TIME_CARD"]);
  for (const sprache of ["de", "en"]) {
    const t = k.TEXTE_LOCALTRACK_ZONE_TIME_CARD[sprache].texte;
    for (const key of ["spalte_tag", "spalte_netto", "spalte_brutto"]) {
      assert.match(t[key], /^\p{Lu}/u, `${sprache}.${key} = ${t[key]}`);
    }
  }
});
