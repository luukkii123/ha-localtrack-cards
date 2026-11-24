"use strict";

// M26 (Buschcheck W2/W10, Nachholetappe J2): every browser render script of
// this repo measures contrast (4.5:1, large 3:1, symbols 3:1) and touch targets
// (44 px) with hacs/scripts/kontrast_touch.py through regeln.py, takes the
// exceptions with reason from docs/render/kontrast-ausnahmen.json, writes the
// areas `kontrast` and `touch` into report.json and fails the run on a finding.
// The CI contract scripts (.github/ci-contracts.txt) have no regeln.py: they
// keep running there and report `kein_urteil` for both areas. Checked in the
// source; the final render run measures in the browser.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const RENDER = path.join(ROOT, "docs", "render");
const SCRIPTS = ["render.py", "zonetime.py", "zindex.py", "shared_ui_contract.py"];
const CI = fs.readFileSync(path.join(ROOT, ".github", "ci-contracts.txt"), "utf8")
  .split("\n").filter((line) => line.trim() && !line.startsWith("#"))
  .map((line) => path.basename(line.trim().split(/\s+/)[0]));

const source = (name) => fs.readFileSync(path.join(RENDER, name), "utf8");

for (const name of SCRIPTS) {
  test(`M26: ${name} measures contrast and touch with the repo's exception list`, () => {
    const text = source(name);
    assert.match(text, /messe_kontrast_touch(_hier)?\(/, "kontrast_touch measurement");
    assert.match(text, /kontrast-ausnahmen\.json/, "exceptions from docs/render/kontrast-ausnahmen.json");
  });
}

test("M26: shared_ui_contract.py measures every card in data and every state, at every width and theme", () => {
  const text = source("shared_ui_contract.py");
  assert.match(text, /kontrast_touch\(page, tag, name, width, theme, "daten"\)/, "data state");
  assert.match(text, /kontrast_touch\(page, tag, name, width, theme, state\)/, "loading/empty/error/missing");
  assert.match(text, /for width in WIDTHS:/, "width loop");
  assert.match(text, /"kontrast": \{"laeufe": \[\]\}, "touch": \{"mindest_px": 44, "laeufe": \[\]\}/, "both areas in report.json");
  assert.match(text, /kontrast_verstoesse[\s\S]*?failures/, "a contrast finding fails the run");
  assert.match(text, /touch_verstoesse[\s\S]*?failures/, "a touch finding fails the run");
  assert.match(text, /no text judged for contrast/, "nothing judged is not a pass");
  assert.match(text, /ungenutzte_ausnahmen/, "unused exceptions reported");
});

test("M26: zindex.py measures light and dark, judges in the verdict and writes both areas", () => {
  const text = source("zindex.py");
  assert.match(text, /for thema in \("light", "dark"\):[\s\S]*?messe_kontrast_touch_hier\(page, "localtrack-timeline-card"/);
  assert.match(text, /verdict\["kontrast_touch_ok"\]/, "verdict entry");
  assert.match(text, /and verdict\["kontrast_touch_ok"\]/, "part of bestanden");
  assert.match(text, /report = \{"messung": results, "urteil": verdict, \*\*kontrast_touch\}/, "areas in report.json");
});

test("M26: CI contract scripts measure only with regeln.py and report kein_urteil without it", () => {
  assert.ok(CI.includes("zindex.py"), "zindex.py is a CI contract");
  for (const name of SCRIPTS.filter((n) => CI.includes(n))) {
    const text = source(name);
    assert.doesNotMatch(text, /^from regeln import|^import regeln$/m, `${name}: unguarded regeln import`);
    assert.match(text, /if regeln and variant == "nachher":/, `${name}: measures only with regeln.py`);
    assert.match(text, /KT_KEIN_URTEIL = \{"kein_urteil": "regeln\.py nicht gefunden - Kontrast\/Touch nicht geprueft"\}/,
      `${name}: report says not checked`);
    assert.match(text, /verdict\["kontrast_touch_ok"\] = not regeln or/, `${name}: CI verdict without regeln`);
  }
});
