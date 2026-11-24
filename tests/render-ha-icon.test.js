"use strict";

// #1328 M79 (Buschcheck W23, Nachholetappe J): every render script of this repo
// installs the shared ha-icon stand-in of hacs/docs/render/regeln.py right after
// the browser starts (real MDI glyphs instead of a diamond or nothing) and puts
// the stand-in state (active, names without a path) into report.json. Scripts
// in the repo CI job `contracts` (.github/ci-contracts.txt) have no regeln.py;
// they keep running there and only skip the stand-in check (pattern
// ha-unraid-cards/docs/render/unraid-cards.py).
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const RENDER = path.join(ROOT, "docs", "render");
const SCRIPTS = ["render.py", "zindex.py", "zonetime.py", "shared_ui_contract.py"];
const CI = fs.readFileSync(path.join(ROOT, ".github", "ci-contracts.txt"), "utf8")
  .split("\n").filter((line) => line.trim() && !line.startsWith("#"))
  .map((line) => path.basename(line.trim().split(/\s+/)[0]));

const source = (name) => fs.readFileSync(path.join(RENDER, name), "utf8");

for (const name of SCRIPTS) {
  test(`M79: ${name} installs the shared ha-icon stand-in after launch`, () => {
    const text = source(name);
    const launch = text.indexOf("chromium.launch(");
    const install = text.search(/ha_icon_attrappe\(browser\)/);
    assert.ok(launch >= 0, "browser launch");
    assert.ok(install > launch, "ha_icon_attrappe(browser) after the launch");
    assert.ok(install < text.indexOf("new_page(", launch), "before the first page");
  });

  test(`M79: ${name} reports the stand-in state and fails on missing glyphs`, () => {
    const text = source(name);
    assert.match(text, /ha_icon_fehlend\(/, "ha_icon_fehlend read");
    assert.match(text, /["']haIcon["']/, "report key haIcon");
    assert.match(text, /\[["']aktiv["']\]/, "verdict uses aktiv");
    assert.match(text, /\[["']fehlend["']\]/, "verdict uses fehlend");
  });
}

test("M79: CI scripts run without regeln.py and only skip the stand-in check", () => {
  assert.ok(CI.includes("zindex.py"), "zindex.py is a CI contract");
  for (const name of SCRIPTS.filter((n) => CI.includes(n))) {
    const text = source(name);
    assert.match(text, /except ImportError:/, `${name}: import guarded`);
    assert.match(text, /regeln = None/, `${name}: CI mode without regeln`);
    assert.match(text, /kein_urteil/, `${name}: report says not checked`);
    assert.match(text, /\/work/, `${name}: runner keeps regeln mandatory`);
  }
});
