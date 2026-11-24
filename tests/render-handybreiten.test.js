"use strict";

// M76 (Buschcheck F14, Nachholetappe J2): both cards and both editors are
// rendered at the phone widths 360 and 390 too (next to 320/480/960), and
// report.json of shared_ui_contract.py names every editor at every width.
// Regel 1 (text stays in its container) is measured on the editor fixture at
// each width; Regel 2 has nothing to open here: the cards and editors bring no
// own popup, and the script fails if one appears (it would need the Regel 2
// measurement). Checked in the source; the final render run measures.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const SCRIPT = fs.readFileSync(path.join(__dirname, "..", "docs", "render", "shared_ui_contract.py"), "utf8");

test("M76: shared_ui_contract.py renders cards, states and editors at 320, 360, 390, 480 and 960", () => {
  assert.match(SCRIPT, /^WIDTHS = \(320, 360, 390, 480, 960\)$/m);
  assert.match(SCRIPT, /for width in WIDTHS:/);
  assert.match(SCRIPT, /"breiten": list\(WIDTHS\)/, "report.json names the widths");
});

test("M76: Regel 1 on the editor fixture at every width, findings fail the run", () => {
  assert.match(SCRIPT, /editor_text = messe_text\(page, "#editor-fixture"\)/);
  assert.match(SCRIPT, /details\["regel1"\] = \{key: len\(editor_text\[key\]\) for key in \("ueberlauf", "ausserhalb", "ueberlappung"\)\}/);
  assert.match(SCRIPT, /if any\(details\["regel1"\]\.values\(\)\) or not details\["regel1_geprueft"\]:/);
});

test("M76: Regel 2, no own popup in cards and editors, else the run fails", () => {
  assert.match(SCRIPT, /def popups\(page, selector\):/);
  assert.match(SCRIPT, /card_popups = popups\(page, tag\)/);
  assert.match(SCRIPT, /details\["popups"\] = popups\(page, "#editor-fixture"\)/);
  assert.match(SCRIPT, /editor has an own popup/);
  assert.match(SCRIPT, /own popup without Regel 2 measurement/);
});

test("M76: report.json lists every editor at every width and fails on a gap", () => {
  assert.match(SCRIPT, /report\["editoren"\]\.append\(\{"editor": f"\{tag\}-editor", "breite": width/);
  for (const tag of ["localtrack-timeline-card-editor", "localtrack-zone-time-card-editor"]) assert.ok(SCRIPT.includes(`"${tag}"`), tag);
  assert.match(SCRIPT, /if _seen != sorted\(WIDTHS\):/);
});
