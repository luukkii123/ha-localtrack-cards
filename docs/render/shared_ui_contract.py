#!/usr/bin/env python3
"""Shared UI contract v0.1.0: real card geometry and editor-schema fixture.

Run in the existing Playwright container with /work (hacs/docs/render) and
/cards (this repository) mounted. The ha-form fixture visualizes the actual
schema, labels and helpers; it does not replace a test in Home Assistant.
"""

import ast
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
import pathlib
import shutil
import sys
import tempfile
import threading

from playwright.sync_api import sync_playwright

for candidate in ("/work", str(pathlib.Path(__file__).resolve().parents[3] / "docs" / "render")):
    if candidate not in sys.path:
        sys.path.append(candidate)
from regeln import _thema_setzen, messe_text


ROOT = pathlib.Path(__file__).resolve().parents[2]
SOURCE = ROOT / "dist" / "localtrack-cards.js"
OUT = ROOT / "docs" / "render" / "shared-ui-ergebnis"
OUT.mkdir(parents=True, exist_ok=True)

CASES = (
    ("timeline", "render.py", "localtrack-timeline-card", ".header", ".controls input[type=date]",
     (".controls input[type=date]", ".scrubber input[type=range]",
      ".leaflet-control-zoom-in", ".leaflet-control-zoom-out", ".segment")),
    ("zonetime", "zonetime.py", "localtrack-zone-time-card", ".head", ".pickers select",
     (".pickers select", ".month button")),
)


def fixture_html(script_name):
    tree = ast.parse((ROOT / "docs" / "render" / script_name).read_text())
    for stmt in tree.body:
        if isinstance(stmt, ast.Assign) and any(
            isinstance(target, ast.Name) and target.id == "PAGE" for target in stmt.targets
        ) and isinstance(stmt.value, ast.Constant):
            return stmt.value.value.replace("__MAXW__", "960")
    raise RuntimeError(f"PAGE fixture missing in {script_name}")


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *_args):
        pass


def server(directory):
    handler = partial(QuietHandler, directory=str(directory))
    httpd = ThreadingHTTPServer(("127.0.0.1", 0), handler)
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    return httpd


def card_measure(page, tag, title_selector, control_selector, action_selectors):
    values = page.evaluate("""({titleSelector, controlSelector, selectors}) => {
      const card = window.__card, root = card.shadowRoot;
      const rect = el => { const r = el.getBoundingClientRect();
        return {x:r.x, y:r.y, right:r.right, bottom:r.bottom, width:r.width, height:r.height}; };
      const actions = selectors.flatMap(sel => [...root.querySelectorAll(sel)].map(el => {
        el.focus();
        return {selector: sel, rect: rect(el), role: el.getAttribute('role'),
          tabIndex: el.tabIndex, focusVisible: root.activeElement === el
            && getComputedStyle(el).outlineStyle !== 'none'};
      }));
      const title = root.querySelector('.title');
      const control = root.querySelector(controlSelector);
      control.focus();
      const focused = root.activeElement === control
        && getComputedStyle(control).outlineStyle !== 'none';
      const tr = rect(title), cr = rect(control);
      return {actions, title: tr, control: cr,
        focused,
        segmentFactsVisible: !root.querySelector('.segment') ||
          ['.times','.meta'].every(sel => {
            const item = root.querySelector('.segment ' + sel);
            return item.clientWidth >= item.scrollWidth;
          }),
        tableVisible: !root.querySelector('table') ||
          root.querySelector('table').getBoundingClientRect().height > 0,
        monthWidth: root.querySelector('.month')?.getBoundingClientRect().width ?? null,
        titleClipped: title.scrollWidth > title.clientWidth
          && getComputedStyle(title).textOverflow === 'ellipsis',
        noHorizontalScroll: document.documentElement.scrollWidth <= innerWidth,
        cardWidth: rect(card).width,
        titleBeforeActions: tr.bottom <= cr.y + 1};
    }""", {"titleSelector": title_selector, "controlSelector": control_selector,
            "selectors": action_selectors})
    measured = messe_text(page, tag)
    values["textIssues"] = {key: len(measured[key]) for key in
                             ("ueberlauf", "ausserhalb", "ueberlappung")}
    return values


def editor_fixture(page, tag):
    return page.evaluate("""tag => {
      let wrap = document.getElementById('editor-fixture');
      if (!wrap) {
        wrap = document.createElement('div'); wrap.id = 'editor-fixture';
        document.body.appendChild(wrap);
      }
      wrap.innerHTML = '';
      wrap.style.cssText = 'box-sizing:border-box;width:100%;padding:16px;' +
        'background:var(--card-background-color);color:var(--primary-text-color);' +
        'font:14px Roboto,sans-serif;';
      const editor = document.createElement(tag + '-editor');
      wrap.appendChild(editor);
      const config = tag.includes('timeline')
        ? {type:'custom:' + tag, entity:'person.test'}
        : {type:'custom:' + tag, entity:'person.test', zone:'zone.test'};
      editor.setConfig(config);
      editor.hass = {...window.__hass, locale:{language:'de'}};
      const form = editor.querySelector('ha-form');
      const style = document.createElement('style');
      style.textContent = '#editor-fixture .fixture-field{padding:8px 0;overflow-wrap:anywhere}' +
        '#editor-fixture label{display:block;font-weight:600;margin-bottom:4px}' +
        '#editor-fixture .helper{color:var(--secondary-text-color);margin-top:4px}' +
        '#editor-fixture .fixture-control{box-sizing:border-box;width:100%;min-height:44px;' +
        'border:1px solid var(--divider-color);border-radius:6px;' +
        'background:var(--card-background-color);color:var(--primary-text-color)}';
      wrap.prepend(style);
      for (const field of form.schema) {
        const row = document.createElement('div'); row.className = 'fixture-field';
        const label = document.createElement('label'); label.textContent = form._label(field);
        const input = document.createElement('input'); input.className = 'fixture-control';
        input.setAttribute('aria-label', label.textContent);
        input.value = String(form.data[field.name] ?? '');
        const helper = document.createElement('div'); helper.className = 'helper';
        helper.textContent = form._helper(field);
        row.append(label,input,helper); form.appendChild(row);
      }
      const fields = [...form.querySelectorAll('.fixture-field')];
      const firstInput = fields[0]?.querySelector('input');
      firstInput?.focus();
      return {count: fields.length, labels: fields.map(e => e.querySelector('label').textContent),
        helpers: fields.map(e => e.querySelector('.helper').textContent),
        focusVisible: firstInput === document.activeElement
          && getComputedStyle(firstInput).outlineStyle !== 'none',
        noHorizontalScroll: document.documentElement.scrollWidth <= innerWidth,
        noFieldCollision: fields.every((field, index) => index === 0 ||
          fields[index - 1].getBoundingClientRect().bottom <=
          field.getBoundingClientRect().top + 1)};
    }""", tag)


report = {"contract": "0.1.0", "cases": [], "failures": []}
with tempfile.TemporaryDirectory() as temp, sync_playwright() as pw:
    browser = pw.chromium.launch(args=["--no-sandbox"])
    for name, script_name, tag, header, control, selectors in CASES:
        directory = pathlib.Path(temp) / name
        directory.mkdir()
        shutil.copy2(SOURCE, directory / "localtrack-cards.js")
        (directory / "page.html").write_text(fixture_html(script_name), encoding="utf-8")
        httpd = server(directory)
        try:
            page = browser.new_page(viewport={"width": 320, "height": 1600}, locale="de-DE")
            page.clock.install(time="2026-09-25T12:00:00+02:00")
            page.goto(f"http://127.0.0.1:{httpd.server_port}/page.html", wait_until="load")
            page.wait_for_function("window.__card && window.__card.shadowRoot")
            if name == "timeline":
                page.wait_for_function("window.__card._map && window.__card._segments.length")
            else:
                page.wait_for_function("window.__card._result")
            page.evaluate("""() => {
              document.body.style.cssText = 'margin:0;padding:0;';
              const wrap = document.getElementById('wrap');
              wrap.style.cssText = 'max-width:none;width:100%;';
              window.__card.shadowRoot.querySelector('.title').textContent =
                'Ein sehr langer Ort und Personenname, der auf kleinen und großen Karten sicher gekürzt werden muss — '.repeat(4);
              const root = window.__card.shadowRoot;
              const segment = root.querySelector('.segment .label');
              if (segment) segment.textContent = 'Ein besonders langer Aufenthaltsort '.repeat(8);
              for (const select of root.querySelectorAll('.pickers select')) {
                if (select.selectedOptions[0]) {
                  select.selectedOptions[0].textContent = 'Ein besonders langer Testname '.repeat(6);
                }
              }
            }""")
            for width in (320, 480, 960):
                for theme in ("light", "dark"):
                    page.set_viewport_size({"width": width, "height": 1600})
                    _thema_setzen(page, theme)
                    if name == "timeline":
                        page.evaluate("() => window.__card._map.invalidateSize()")
                    page.wait_for_timeout(250)
                    page.keyboard.press("Tab")
                    sample = card_measure(page, tag, header, control, selectors)
                    label = f"{name}-{width}-{theme}"
                    report["cases"].append({"name": label, **sample})
                    bad = [a for a in sample["actions"] if
                           a["rect"]["width"] < 44 or a["rect"]["height"] < 44]
                    if bad:
                        report["failures"].append(f"{label}: actions below 44px: {bad}")
                    if any(not action["focusVisible"] for action in sample["actions"]):
                        report["failures"].append(f"{label}: an action has no visible keyboard focus")
                    if width <= 440 and not sample["titleBeforeActions"]:
                        report["failures"].append(f"{label}: header title collides with actions")
                    if name == "zonetime" and sample["monthWidth"] > 440:
                        report["failures"].append(f"{label}: month controls too far apart")
                    if not sample["segmentFactsVisible"] or not sample["tableVisible"]:
                        report["failures"].append(f"{label}: primary facts hidden")
                    if not sample["titleClipped"] or not sample["noHorizontalScroll"]:
                        report["failures"].append(f"{label}: long title or horizontal scroll")
                    if any(sample["textIssues"].values()):
                        report["failures"].append(f"{label}: visible text issues {sample['textIssues']}")
                    if not sample["focused"]:
                        report["failures"].append(f"{label}: keyboard focus not visible")
                    if name == "timeline" and any(
                        a["role"] != "button" or a["tabIndex"] != 0
                        for a in sample["actions"] if a["selector"] == ".segment"
                    ):
                        report["failures"].append(f"{label}: segment lacks keyboard semantics")
                    page.locator(tag).screenshot(path=str(OUT / f"{label}-card.png"))
                    details = editor_fixture(page, tag)
                    report["cases"][-1]["editor"] = details
                    if (not details["count"] or not all(details["helpers"])
                            or not details["noHorizontalScroll"]
                            or not details["noFieldCollision"]
                            or not details["focusVisible"]):
                        report["failures"].append(f"{label}: editor fields/helper/geometry")
                    page.locator("#editor-fixture").screenshot(path=str(OUT / f"{label}-editor.png"))
                    page.locator("#editor-fixture").evaluate("el => el.remove()")
                    for state in ("loading", "empty", "error", "missing"):
                        page.evaluate("""({name, state}) => {
                          const card = window.__card, root = card.shadowRoot;
                          const saved = {
                            segments: root.querySelector('.segments')?.innerHTML,
                            scrubberDisplay: root.querySelector('.scrubber')?.style.display,
                            scrubberLabel: root.querySelector('.scrub-label')?.textContent,
                            body: root.querySelector('tbody')?.innerHTML,
                            foot: root.querySelector('tfoot')?.innerHTML,
                            note: root.querySelector('.note')?.innerHTML,
                            result: card._result,
                            tableHidden: root.querySelector('table')?.hidden,
                          };
                          window.__restoreState = () => {
                            if (name === 'timeline') {
                              root.querySelector('.segments').innerHTML = saved.segments;
                              root.querySelector('.scrubber').style.display = saved.scrubberDisplay;
                              root.querySelector('.scrub-label').textContent = saved.scrubberLabel;
                            } else {
                              root.querySelector('tbody').innerHTML = saved.body;
                              root.querySelector('tfoot').innerHTML = saved.foot;
                              root.querySelector('.note').innerHTML = saved.note;
                              root.querySelector('table').hidden = saved.tableHidden;
                              card._result = saved.result;
                            }
                            card._showStatus('');
                          };
                          if (name === 'timeline') {
                            root.querySelector('.segments').innerHTML = '';
                            root.querySelector('.scrubber').style.display = 'none';
                            root.querySelector('.scrub-label').textContent = '';
                            const message = state === 'loading' ? card._t.laden
                              : state === 'empty' ? card._t.keine_punkte
                              : state === 'missing' ? card._t.nicht_eingerichtet
                              : card._t.ladefehler;
                            card._showStatus(message);
                          } else if (state === 'empty') {
                            card._result = {days:[],days_present:0,total_net_s:0,
                              total_gross_s:0,total_visits:0};
                            const days = new Date(card._month.year, card._month.month, 0).getDate();
                            card._render(days, card._month);
                            card._showStatus('');
                          } else {
                            root.querySelector('tbody').innerHTML = '';
                            root.querySelector('tfoot').innerHTML = '';
                            root.querySelector('.note').textContent = '';
                            root.querySelector('table').hidden = true;
                            const message = state === 'loading' ? card._t.laden
                              : state === 'missing' ? card._t.zone_ohne_koordinaten
                                  .replace('{zone}', 'zone.work')
                              : card._t.ladefehler;
                            card._showStatus(message);
                          }
                        }""", {"name": name, "state": state})
                        state_text = messe_text(page, tag)
                        issues = {key: len(state_text[key]) for key in
                                  ("ueberlauf", "ausserhalb", "ueberlappung")}
                        if any(issues.values()):
                            report["failures"].append(f"{label}-{state}: visible text {issues}")
                        if width == 320:
                            page.locator(tag).screenshot(
                                path=str(OUT / f"{label}-{state}.png"))
                        page.evaluate("() => window.__restoreState()")
            state_contract = page.evaluate("""async name => {
              const card = window.__card, root = card.shadowRoot;
              const previousCall = card._hass.callWS;
              if (name === 'timeline') {
                const segment = root.querySelector('.segment');
                const previousPan = card._map.panTo;
                let pans = 0;
                card._map.panTo = () => { pans += 1; return card._map; };
                segment.dispatchEvent(new KeyboardEvent('keydown',
                  {key:'Enter',bubbles:true,cancelable:true}));
                segment.dispatchEvent(new KeyboardEvent('keydown',
                  {key:' ',bubbles:true,cancelable:true}));
                card._map.panTo = previousPan;
                const segmentKeys = pans === 2;
                card._hass.callWS = async () => ({points: []});
                await card._loadDay();
                const empty = root.querySelectorAll('.segment').length === 0
                  && root.querySelector('.scrubber').getBoundingClientRect().height === 0
                  && !root.querySelector('.scrub-label').textContent.trim();
                card._hass.callWS = async () => { throw {code:'not_found'}; };
                await card._loadDay();
                card._hass.callWS = previousCall;
                return {segmentKeys, empty, error: root.querySelectorAll('.segment').length === 0
                  && root.querySelector('.scrubber').getBoundingClientRect().height === 0
                  && root.querySelector('.map-overlay').textContent.trim().length > 0};
              }
              card._result = {days:[],days_present:0,total_net_s:0,
                total_gross_s:0,total_visits:0};
              card._render(new Date(card._month.year, card._month.month, 0).getDate(),
                card._month);
              const empty = root.querySelector('table').getBoundingClientRect().height === 0
                && root.querySelector('.note').textContent.trim().length > 0;
              card._hass.callWS = async message => {
                if (message.type === 'localtrack/zone_time') throw {code:'failure'};
                return previousCall(message);
              };
              await card._load();
              const error = !root.querySelector('.note').textContent.trim()
                && root.querySelector('tbody').children.length === 0
                && root.querySelector('.status').textContent.trim().length > 0;
              card._zone = 'zone.missing';
              await card._load();
              card._hass.callWS = previousCall;
              return {empty, error, missing: !root.querySelector('.note').textContent.trim()
                && root.querySelector('tbody').children.length === 0
                && root.querySelector('.status').textContent.trim().length > 0};
            }""", name)
            report["cases"].append({"name": f"{name}-actual-states", **state_contract})
            for state, passed in state_contract.items():
                if not passed:
                    report["failures"].append(f"{name}: real {state} state retains stale data")
            page.close()
        finally:
            httpd.shutdown()
            httpd.server_close()
    browser.close()

(OUT / "report.json").write_text(json.dumps(report, indent=2, ensure_ascii=False))
print(json.dumps({"cases": len(report["cases"]), "failures": report["failures"]}, ensure_ascii=False))
sys.exit(bool(report["failures"]))
