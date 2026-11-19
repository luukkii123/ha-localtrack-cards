'use strict';
// #1320 (Etappe I, focus rings, WCAG 2.4.11/1.4.11): every own focus ring of the card draws with the shared token
// BuschUI.tokens.focusColor (hook --busch-focus-color, default the theme colour 60 % with the text colour) and reaches 3:1
// against the card and the secondary surface in light and dark. The primary blue alone was 2.63:1 on white (#03a9f4).
// Theme values of the render runs (hacs/docs/render/regeln.py THEMA_CSS; Arrstack #1c76be), formula as hacs/scripts/kontrast_touch.py.
// A ring that sits on a lit/tinted light surface (Lightcards) takes the readable text colour of that surface first;
// unset at test time, so its token fallback is measured.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SOURCE = fs.readFileSync(path.join(__dirname, '..', 'dist', 'localtrack-cards.js'), 'utf8');
const BEGIN = SOURCE.indexOf('/* BEGIN BUSCH SHARED UI'), END = SOURCE.indexOf('/* END BUSCH SHARED UI */');
const UI = (() => { const box = {}; vm.createContext(box); return vm.runInContext(SOURCE.slice(BEGIN, END) + '\nBuschUI', box); })();
// The card CSS interpolates the token in its template literals: resolve it before the rules are split at braces.
const OWN = (SOURCE.slice(0, BEGIN) + SOURCE.slice(END)).split('${BuschUI.tokens.focusColor}').join(UI.tokens.focusColor);

const THEMES = {
  'light': { 'primary-color': '#03a9f4', 'primary-text-color': '#212121', 'card-background-color': '#ffffff', 'secondary-background-color': '#e5e5e5' },
  'dark': { 'primary-color': '#03a9f4', 'primary-text-color': '#e1e1e1', 'card-background-color': '#1c1c1c', 'secondary-background-color': '#202020' },
  'arrstack-light': { 'primary-color': '#1c76be', 'primary-text-color': '#212121', 'card-background-color': '#ffffff', 'secondary-background-color': '#e5e5e5' },
  'arrstack-dark': { 'primary-color': '#1c76be', 'primary-text-color': '#e1e1e1', 'card-background-color': '#1c1c1c', 'secondary-background-color': '#202020' },
};
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
function split(text) {
  const out = []; let depth = 0, start = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '(') depth++; else if (text[i] === ')') depth--;
    else if (text[i] === ',' && depth === 0) { out.push(text.slice(start, i).trim()); start = i + 1; }
  }
  out.push(text.slice(start).trim()); return out;
}
function colour(value, theme) {
  value = value.trim(); let m;
  if (/^#[0-9a-f]{6}$/i.test(value)) return hex(value);
  if ((m = value.match(/^var\((.*)\)$/s))) {
    const [name, ...rest] = split(m[1]), key = name.replace(/^--/, '');
    if (theme[key]) return hex(theme[key]);
    assert.ok(rest.length, 'no fallback for ' + name);
    return colour(rest.join(','), theme);
  }
  if ((m = value.match(/^color-mix\(in srgb,(.*)\)$/s))) {
    const [a, b] = split(m[1]), pa = a.match(/^(.*) (\d+)%$/s);
    const p = pa[2] / 100, ca = colour(pa[1], theme), cb = colour(b, theme);
    return ca.map((v, i) => v * p + cb[i] * (1 - p));
  }
  throw new Error('colour not understood: ' + value);
}
const lum = (c) => { const l = c.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * l[0] + 0.7152 * l[1] + 0.0722 * l[2]; };
const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };

test('#1320 every own focus ring uses the shared focus token and reaches 3:1 on card and secondary surface, light and dark', () => {
  const token = UI.tokens.focusColor, rings = [], cases = [];
  assert.equal(typeof token, 'string', 'BuschUI.tokens.focusColor');
  for (const m of OWN.matchAll(/([^{}]*:focus[^{}]*)\{([^{}]*)\}/g)) {
    const body = m[2], o = body.match(/(?:^|[;\s])outline:\s*[^;]*?solid\s+([^;]+?)\s*(?:;|$)/) || body.match(/outline-color:\s*([^;]+?)\s*(?:;|$)/);
    if (!o) continue;
    const selector = m[1].trim().split(/\s+/).join(' ').slice(-90), value = o[1];
    rings.push(selector);
    assert.ok(value.includes(token), selector + ' draws with the focus token: ' + o[1]);
    for (const [name, theme] of Object.entries(THEMES)) for (const surface of ['card-background-color', 'secondary-background-color']) {
      const q = ratio(colour(value, theme), hex(theme[surface])); cases.push(selector + ' ' + name + ' ' + surface + ' ' + q.toFixed(2));
      assert.ok(q >= 3, cases.at(-1) + ':1');
    }
  }
  assert.equal(rings.length, 1, rings.join(' | '));
  assert.equal(cases.length, 1 * 8);
});
