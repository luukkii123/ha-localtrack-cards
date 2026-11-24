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
import os
import pathlib
import shutil
import sys
import tempfile
import threading
import struct
import zlib

from playwright.sync_api import sync_playwright

for candidate in ("/work", str(pathlib.Path(__file__).resolve().parents[3] / "docs" / "render")):
    if candidate not in sys.path:
        sys.path.append(candidate)
from regeln import _thema_setzen, ha_icon_attrappe, ha_icon_fehlend, messe_kontrast_touch_hier, messe_text


ROOT = pathlib.Path(__file__).resolve().parents[2]
SOURCE = pathlib.Path(os.environ.get(
    "LOCALTRACK_CONTRACT_SOURCE", ROOT / "dist" / "localtrack-cards.js"
))
OUT = pathlib.Path(os.environ.get(
    "LOCALTRACK_CONTRACT_OUT", ROOT / "docs" / "render" / "shared-ui-ergebnis"
))
OUT.mkdir(parents=True, exist_ok=True)
# M26: contrast and touch exceptions of this repo (with reason), shared with render.py and zonetime.py.
AUSNAHMEN = pathlib.Path(__file__).with_name("kontrast-ausnahmen.json")
# M76: phone widths 360 and 390 next to 320/480/960 for every card, state and editor.
WIDTHS = (320, 360, 390, 480, 960)

CASES = (
    ("timeline", "render.py", "localtrack-timeline-card", ".header", ".controls input[type=date]",
     (".controls input[type=date]", ".controls button", ".scrubber input[type=range]",
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


def png_pixels(data):
    """Decode an 8-bit RGB/RGBA PNG (Playwright screenshot) into rows of RGB tuples."""
    assert data[:8] == b"\x89PNG\r\n\x1a\n", "not a PNG"
    pos, idat = 8, b""
    while pos < len(data):
        length, kind = struct.unpack(">I4s", data[pos:pos + 8])
        body = data[pos + 8:pos + 8 + length]
        if kind == b"IHDR":
            width, height, depth, colour, _, _, interlace = struct.unpack(">IIBBBBB", body)
            assert depth == 8 and colour in (2, 6) and interlace == 0, "unsupported PNG"
        elif kind == b"IDAT":
            idat += body
        pos += 12 + length
    step = 3 if colour == 2 else 4
    raw, stride, rows, prev = zlib.decompress(idat), width * step, [], bytearray(width * step)
    for y in range(height):
        kind, line = raw[y * (stride + 1)], bytearray(raw[y * (stride + 1) + 1:(y + 1) * (stride + 1)])
        for i in range(stride):
            left = line[i - step] if i >= step else 0
            up, corner = prev[i], prev[i - step] if i >= step else 0
            if kind == 1:
                line[i] = (line[i] + left) & 255
            elif kind == 2:
                line[i] = (line[i] + up) & 255
            elif kind == 3:
                line[i] = (line[i] + (left + up) // 2) & 255
            elif kind == 4:
                pa, pb, pc = abs(up - corner), abs(left - corner), abs(left + up - 2 * corner)
                line[i] = (line[i] + (left if pa <= pb and pa <= pc else up if pb <= pc else corner)) & 255
        rows.append([tuple(line[x * step:x * step + 3]) for x in range(width)])
        prev = line
    return rows


def map_corner_frame(page, size=16, tolerance=3):
    """#1318 image review: the map box in an empty/loading/error state shows no
    corner arcs. Every pixel in the four corner squares of `.map-wrap` must
    equal the surface of the state box (sampled at the top middle); the
    anti-aliased arcs of a painted map underneath differed by 44 (light) and
    72 (dark) levels in the run of 2026-11-19. Returns the worst deviation."""
    shot = page.locator("localtrack-timeline-card").locator(".map-wrap").screenshot()
    rows = png_pixels(shot)
    height, width = len(rows), len(rows[0])
    surface = rows[4][width // 2]
    worst = {"abweichung": 0, "x": None, "y": None, "flaeche": surface}
    for ys in (range(size), range(height - size, height)):
        for xs in (range(size), range(width - size, width)):
            for y in ys:
                for x in xs:
                    deviation = max(abs(a - b) for a, b in zip(rows[y][x], surface))
                    if deviation > worst["abweichung"]:
                        worst.update(abweichung=deviation, x=x, y=y, pixel=rows[y][x])
    worst["bestanden"] = worst["abweichung"] <= tolerance
    return worst


def kontrast_touch(page, tag, name, width, theme, zustand):
    """M26: contrast (4.5:1, large 3:1, symbols 3:1) and touch targets (44 px) of the
    card in its current state; one run per card, width, theme and state in report.json."""
    measured = messe_kontrast_touch_hier(page, tag, ausnahmen=AUSNAHMEN)
    label = f"{name}-{width}-{theme}-{zustand}"
    for area in ("kontrast", "touch"):
        report[area]["ausnahmen_datei"] = measured[area].get("ausnahmen_datei")
        report[area]["laeufe"].append({"breite": width, "thema": theme, "karte": name, "zustand": zustand,
                                       **measured[area]})
    kontrast, touch = measured["kontrast"], measured["touch"]
    if kontrast.get("kontrast_verstoesse"):
        report["failures"].append(f"{label}: contrast {kontrast['kontrast_verstoesse']}")
    if not kontrast.get("geprueft"):
        report["failures"].append(f"{label}: no text judged for contrast")
    if touch.get("touch_verstoesse"):
        report["failures"].append(f"{label}: touch targets below 44px {touch['touch_verstoesse']}")


def popups(page, selector):
    """M76/Regel 2: own popups (dialog, role=dialog, fixed overlay) below `selector`,
    across shadow roots. The cards and editors have none; a new one would need
    the Regel 2 measurement (Escape, back, close, scrim)."""
    return page.evaluate("""selector => {
      const roots = [], walk = root => { roots.push(root);
        for (const el of root.querySelectorAll('*')) if (el.shadowRoot) walk(el.shadowRoot); };
      const host = document.querySelector(selector);
      if (!host) return ['missing ' + selector];
      walk(host.shadowRoot || host);
      return roots.flatMap(root => [...root.querySelectorAll('*')])
        .filter(el => el.localName === 'dialog' || el.getAttribute('role') === 'dialog'
          || el.getAttribute('aria-modal') === 'true' || getComputedStyle(el).position === 'fixed')
        .map(el => el.localName + (el.className ? '.' + String(el.className).split(' ').join('.') : ''));
    }""", selector)


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


report = {"contract": "0.1.0", "breiten": list(WIDTHS), "cases": [], "failures": [], "haIcon": {},
          "kontrast": {"laeufe": []}, "touch": {"mindest_px": 44, "laeufe": []}, "editoren": []}
with tempfile.TemporaryDirectory() as temp, sync_playwright() as pw:
    browser = pw.chromium.launch(args=["--no-sandbox"])
    ha_icon_attrappe(browser)  # M79: shared ha-icon with the real MDI glyphs (hacs/docs/render/mdi-pfade.json)
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
            for width in WIDTHS:
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
                    kontrast_touch(page, tag, name, width, theme, "daten")
                    card_popups = popups(page, tag)
                    if card_popups:
                        report["failures"].append(f"{label}: own popup without Regel 2 measurement {card_popups}")
                    details = editor_fixture(page, tag)
                    # M76: Regel 1 (text in its container) and Regel 2 (no own popup) for the editor at every width.
                    editor_text = messe_text(page, "#editor-fixture")
                    details["regel1"] = {key: len(editor_text[key]) for key in ("ueberlauf", "ausserhalb", "ueberlappung")}
                    details["regel1_geprueft"] = editor_text.get("geprueft", 0)
                    details["popups"] = popups(page, "#editor-fixture")
                    report["cases"][-1]["editor"] = details
                    report["editoren"].append({"editor": f"{tag}-editor", "breite": width, "thema": theme,
                                               "regel1": details["regel1"], "popups": details["popups"],
                                               "bild": f"{label}-editor.png"})
                    if (not details["count"] or not all(details["helpers"])
                            or not details["noHorizontalScroll"]
                            or not details["noFieldCollision"]
                            or not details["focusVisible"]):
                        report["failures"].append(f"{label}: editor fields/helper/geometry")
                    if any(details["regel1"].values()) or not details["regel1_geprueft"]:
                        report["failures"].append(f"{label}: editor Regel 1 {details['regel1']}")
                    if details["popups"]:
                        report["failures"].append(f"{label}: editor has an own popup {details['popups']}")
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
                            card._showStatus(null);
                          };
                          if (name === 'timeline') {
                            root.querySelector('.segments').innerHTML = '';
                            root.querySelector('.scrubber').style.display = 'none';
                            root.querySelector('.scrub-label').textContent = '';
                            const message = state === 'loading' ? card._t.laden
                              : state === 'empty' ? card._t.keine_punkte
                              : state === 'missing' ? card._t.nicht_eingerichtet
                              : card._t.ladefehler;
                            // M27: kind of the state block, loading/empty a status, the rest an alert.
                            card._showStatus(state === 'loading' || state === 'empty' ? state : 'error', message);
                          } else if (state === 'empty') {
                            card._result = {days:[],days_present:0,total_net_s:0,
                              total_gross_s:0,total_visits:0};
                            const days = new Date(card._month.year, card._month.month, 0).getDate();
                            card._render(days, card._month);
                            card._showResultState();
                          } else {
                            root.querySelector('tbody').innerHTML = '';
                            root.querySelector('tfoot').innerHTML = '';
                            root.querySelector('.note').textContent = '';
                            root.querySelector('table').hidden = true;
                            const message = state === 'loading' ? card._t.laden
                              : state === 'missing' ? card._t.zone_ohne_koordinaten
                                  .replace('{zone}', 'zone.work')
                              : card._t.ladefehler;
                            card._showStatus(state === 'loading' ? 'loading' : 'error', message);
                          }
                        }""", {"name": name, "state": state})
                        state_text = messe_text(page, tag)
                        issues = {key: len(state_text[key]) for key in
                                  ("ueberlauf", "ausserhalb", "ueberlappung")}
                        if any(issues.values()):
                            report["failures"].append(f"{label}-{state}: visible text {issues}")
                        kontrast_touch(page, tag, name, width, theme, state)
                        if name == "timeline":
                            # #1318: no second frame (corner arcs) around the state box.
                            corners = map_corner_frame(page)
                            report["cases"][-1].setdefault("mapCorners", {})[state] = corners
                            if not corners["bestanden"]:
                                report["failures"].append(
                                    f"{label}-{state}: map corners show a second frame {corners}")
                        if width == 320:
                            page.locator(tag).screenshot(
                                path=str(OUT / f"{label}-{state}.png"))
                        page.evaluate("() => window.__restoreState()")
            state_contract = page.evaluate("""async name => {
              const card = window.__card, root = card.shadowRoot;
              const previousCall = card._hass.callWS;
              if (name === 'timeline') {
                // A live update to today's tracked person is debounced by
                // the real hass setter. Keep one selected point and a focused,
                // scrolled segment while the backend adds/removes points.
                const scrubber = root.querySelector('.scrubber input[type=range]');
                const segments = root.querySelector('.segments');
                const original = card._points;
                const originalSegments = card._segments;
                const targetIndex = 20;
                const target = original[targetIndex];
                const focused = root.querySelector('.segment:nth-child(3)');
                if (!target || !focused) throw new Error('timeline fixture needs a point and segments');
                segments.style.maxHeight = '100px';
                segments.style.overflowY = 'auto';
                scrubber.value = String(targetIndex);
                card._renderScrubber();
                segments.scrollTop = 75;
                focused.focus();
                const focusedTimes = focused.querySelector('.times').textContent;
                const originalTimestamp = original[40].ts;
                const updated = [
                  ...original.slice(0, targetIndex),
                  {...target, ts: target.ts - 1},
                  ...original.slice(targetIndex, -1),
                ];
                for (let i = 13; i <= 18; i += 1) {
                  updated[i] = {...updated[i], lat: 52.5191, lon: 13.3954};
                }
                let liveCalls = 0;
                let resolveLive;
                card._hass.callWS = async message => {
                  if (message.type === 'localtrack/history') {
                    liveCalls += 1;
                    return new Promise(resolve => { resolveLive = () => resolve({points: updated}); });
                  }
                  return previousCall(message);
                };
                const lastUpdated = card._hass.states['person.test'].last_updated;
                const nativeSetTimeout = window.setTimeout;
                let refresh;
                window.setTimeout = (callback, delay, ...args) => {
                  if (delay === 30000) {
                    refresh = () => callback(...args);
                    return 987654;
                  }
                  return nativeSetTimeout(callback, delay, ...args);
                };
                // Only a position change triggers the refresh (#1304, M35).
                for (let i = 1; i <= 3; i += 1) {
                  const person = card._hass.states['person.test'];
                  card.hass = {...card._hass, states: {...card._hass.states,
                    'person.test': {...person, last_updated: `${lastUpdated}-live-${i}`,
                      attributes: {...person.attributes,
                        latitude: (person.attributes.latitude ?? 52.52) + 0.0001 * i}}}};
                }
                // This check is about the live refresh that fetches the whole
                // day again (it changes points before the last one); a load
                // older than 15 min takes that path (gap, M35).
                card._loadedAt = 0;
                window.setTimeout = nativeSetTimeout;
                let liveLoad;
                const originalLoadDay = card._loadDay;
                card._loadDay = function(...args) {
                  liveLoad = originalLoadDay.apply(this, args);
                  return liveLoad;
                };
                refresh();
                await Promise.resolve();
                await Promise.resolve();
                scrubber.value = '40';
                card._renderScrubber();
                focused.focus();
                segments.scrollTop = 125;
                const selectedWhileLoading = Number(scrubber.value);
                const userScrollTop = segments.scrollTop;
                const preservedWhileLoading = {
                  scrubberPointVisible: selectedWhileLoading === 40,
                  segmentNodeRetained: segments.contains(focused),
                  focusedWhileLoading: root.activeElement === focused,
                  scrollWhileLoading: Math.abs(segments.scrollTop - userScrollTop) <= 1,
                  liveRefreshDoesNotMaskContent: !root.querySelector('.map-wrap').classList.contains('busy')
                    && !root.querySelector('.map-overlay').textContent.trim(),
                };
                resolveLive();
                await liveLoad;
                card._loadDay = originalLoadDay;
                const expectedIndex = updated.findIndex(point => point.ts === originalTimestamp);
                const active = root.activeElement;
                const stableFocus = active?.classList.contains('segment')
                  && active.querySelector('.times')?.textContent === focusedTimes;
                const liveUpdate = {
                  oneDebouncedReload: liveCalls === 1,
                  scrubberPointPreserved: Number(scrubber.value) === expectedIndex,
                  focusedSegmentPreserved: !!stableFocus,
                  segmentNodePreserved: segments.contains(focused),
                  focusedSegmentMovedAfterNewSegment: [...segments.children].indexOf(focused) > 2,
                  segmentScrollPreserved: Math.abs(segments.scrollTop - userScrollTop) <= 1,
                  latestBackendPointsApplied: card._points.length === updated.length,
                  ...Object.fromEntries(Object.entries(preservedWhileLoading).map(
                    ([key, value]) => [`${key}BeforeResponse`, value]
                  )),
                };
                const oldLastTimestamp = card._points.at(-1).ts;
                scrubber.value = String(card._points.length - 1);
                const grown = [{...card._points[0], ts: card._points[0].ts - 1}, ...card._points];
                card._hass.callWS = async () => ({points: grown});
                card._loadedAt = 0;   // whole day again, see above (M35)
                await originalLoadDay.call(card, {preserveInteraction: true});
                const scrubberLastTimestampPreserved = card._points[Number(scrubber.value)]?.ts === oldLastTimestamp;
                card._hass.callWS = previousCall;
                // Restore only the rendered fixture for the later empty/error
                // checks; the assertions above use the changed backend result.
                card._points = original;
                card._segments = originalSegments;
                card._renderTrack();
                await card._renderSegments();
                const previousPan = card._map.panTo;
                let pans = 0;
                card._map.panTo = () => { pans += 1; return card._map; };
                const segment = root.querySelector('.segment');
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
                const rootBeforeConfig = card.shadowRoot;
                const scrubberBeforeConfig = root.querySelector('.scrubber input[type=range]');
                card.setConfig(Object.fromEntries(Object.entries(card._config).reverse()));
                const equivalentConfigPreserved = card.shadowRoot === rootBeforeConfig
                  && root.querySelector('.scrubber input[type=range]') === scrubberBeforeConfig;
                return { ...liveUpdate, scrubberLastTimestampPreserved, segmentKeys, empty, error: root.querySelectorAll('.segment').length === 0
                  && root.querySelector('.scrubber').getBoundingClientRect().height === 0
                  && root.querySelector('.map-overlay').textContent.trim().length > 0,
                  equivalentConfigPreserved};
              }
              if (name !== 'zonetime') return {};
              card._result = {days:[],days_present:0,total_net_s:0,
                total_gross_s:0,total_visits:0};
              card._render(new Date(card._month.year, card._month.month, 0).getDate(),
                card._month);
              card._showResultState();
              // M27: an empty month is the state block above the hidden table, not a note line.
              const empty = root.querySelector('table').getBoundingClientRect().height === 0
                && root.querySelector('.status').getAttribute('data-kind') === 'empty'
                && root.querySelector('.status .busch-state-title').textContent.trim().length > 0;
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
            # M79: stand-in active, every requested icon has a path.
            ha_icon = report["haIcon"][name] = ha_icon_fehlend(page)
            if not ha_icon["aktiv"] or ha_icon["fehlend"]:
                report["failures"].append(f"{name}: ha-icon stand-in {ha_icon}")
            page.close()
        finally:
            httpd.shutdown()
            httpd.server_close()
    browser.close()

# M26: exceptions of the list that no run used (as regeln.messe_kontrast_touch reports them).
_liste = json.loads(AUSNAHMEN.read_text(encoding="utf-8")) if AUSNAHMEN.is_file() else {}
for _area in ("kontrast", "touch"):
    _used = {a.get("selektor") for run in report[_area]["laeufe"] for a in run.get("ausnahmen", [])}
    report[_area]["ungenutzte_ausnahmen"] = [a["selektor"] for a in _liste.get(_area, []) if a["selektor"] not in _used]
# M76: every editor at every width, 360 and 390 included.
for _tag in ("localtrack-timeline-card-editor", "localtrack-zone-time-card-editor"):
    _seen = sorted({e["breite"] for e in report["editoren"] if e["editor"] == _tag})
    if _seen != sorted(WIDTHS):
        report["failures"].append(f"{_tag}: widths {_seen}, expected {sorted(WIDTHS)}")

(OUT / "report.json").write_text(json.dumps(report, indent=2, ensure_ascii=False))
print(json.dumps({"cases": len(report["cases"]), "failures": report["failures"]}, ensure_ascii=False))
sys.exit(bool(report["failures"]))
