#!/usr/bin/env python3
"""Browser regression for both localtrack card editor configuration contracts.

Run in the same Playwright container as render.py:
    python3 /cards/docs/render/editor_contract.py /cards/dist/localtrack-cards.js
"""

import pathlib
import sys

from playwright.sync_api import sync_playwright


SOURCE = pathlib.Path(sys.argv[1])

HTML = """<!doctype html><html><body><script>
class HaForm extends HTMLElement {
  constructor() {
    super();
    this.writes = 0;
    this.attachShadow({mode: 'open'}).innerHTML = '<input aria-label="Test input">';
  }
  set data(value) {
    this._data = value;
    this.writes += 1;
    // A reactive form may replace its input after receiving new data.
    if (this.shadowRoot.activeElement) this.shadowRoot.activeElement.blur();
  }
  get data() { return this._data; }
  fire(value) {
    this.dispatchEvent(new CustomEvent('value-changed', {detail: {value}, bubbles: true}));
  }
}
customElements.define('ha-form', HaForm);
</script></body></html>"""


def probe(page, tag, initial, first, second, expected):
    return page.evaluate("""({tag, initial, first, second, expected}) => {
      const editor = document.createElement(tag);
      document.body.appendChild(editor);
      const source = structuredClone(initial);
      editor.setConfig(source);
      editor.hass = {locale: {language: 'de'}};
      const form = editor.querySelector('ha-form');
      const input = form.shadowRoot.querySelector('input');
      input.focus();
      const sourceUnchanged = JSON.stringify(source) === JSON.stringify(initial);
      source.extra.options.tags[0] = 'source mutation';

      const events = [];
      editor.addEventListener('config-changed', event => events.push(event.detail.config));
      form.fire(first);
      const incomingIsolated = events[0].extra.options.tags[0] === 'original';
      events[0].extra.options.tags[0] = 'event mutation';
      form.fire(second);
      const emittedIsolated = events[1].extra.options.tags[0] === 'original';
      const immediate = events.length === 2
        && Object.entries(expected).every(([key, value]) =>
          JSON.stringify(events[1][key]) === JSON.stringify(value));

      input.focus();
      const initialWrites = form.writes;
      editor.setConfig(structuredClone(events[1]));
      editor.hass = {locale: {language: 'de'}};
      const sameConfigPreservesFocus = document.activeElement === form
        && form.shadowRoot.activeElement === input
        && form.writes === initialWrites;
      const beforeEcho = form.writes;
      editor.setConfig(structuredClone(events[1]));
      const echoPreservesFocus = form.writes === beforeEcho
        && form.shadowRoot.activeElement === input;

      let documentKeys = 0;
      const keyListener = () => { documentKeys += 1; };
      document.addEventListener('keydown', keyListener);
      document.addEventListener('keyup', keyListener);
      const down = new KeyboardEvent('keydown', {key: 'a', bubbles: true, composed: true,
                                                  cancelable: true});
      const up = new KeyboardEvent('keyup', {key: 'a', bubbles: true, composed: true,
                                              cancelable: true});
      input.dispatchEvent(down);
      input.dispatchEvent(up);
      document.body.dispatchEvent(new KeyboardEvent('keydown', {key: 'a', bubbles: true}));
      document.removeEventListener('keydown', keyListener);
      document.removeEventListener('keyup', keyListener);

      editor.setConfig({...events[1], title: 'Extern geändert'});
      const externalConfigApplied = form.writes === beforeEcho + 1
        && form.data.title === 'Extern geändert';
      editor.remove();
      return {sameConfigPreservesFocus, immediate, sourceUnchanged,
              incomingIsolated, emittedIsolated,
              echoPreservesFocus, localKeysOnly: documentKeys === 1,
              nativeKeysUnaffected: !down.defaultPrevented && !up.defaultPrevented,
              externalConfigApplied, events};
    }""", dict(tag=tag, initial=initial, first=first, second=second, expected=expected))


with sync_playwright() as pw:
    browser = pw.chromium.launch(args=["--no-sandbox"])
    page = browser.new_page()
    page.set_content(HTML)
    page.add_script_tag(path=str(SOURCE))
    cases = [
        ("localtrack-timeline-card-editor",
         {"type": "custom:localtrack-timeline-card", "entity": "person.test",
          "extra": {"options": {"tags": ["original", 0, False]}}},
         {"title": "Erster Titel"}, {"show_scrubber": False, "max_points": 0},
         {"type": "custom:localtrack-timeline-card", "entity": "person.test",
          "extra": {"options": {"tags": ["original", 0, False]}},
          "title": "Erster Titel", "show_scrubber": False, "max_points": 0}),
        ("localtrack-zone-time-card-editor",
         {"type": "custom:localtrack-zone-time-card", "entity": "person.test",
          "zone": "zone.work", "extra": {"options": {"tags": ["original", 0, False]}}},
         {"title": "Erster Titel"}, {"min_visit_minutes": 0, "show_gross": False},
         {"type": "custom:localtrack-zone-time-card", "entity": "person.test",
          "zone": "zone.work", "title": "Erster Titel",
          "extra": {"options": {"tags": ["original", 0, False]}},
          "min_visit_minutes": 0, "show_gross": False}),
    ]
    failed = []
    for tag, initial, first, second, expected in cases:
        result = probe(page, tag, initial, first, second, expected)
        for name, passed in result.items():
            if name != "events" and not passed:
                failed.append(f"{tag}: {name} (events={result['events']})")
    browser.close()
    if failed:
        raise AssertionError("\n".join(failed))
    print(f"Editor contracts: {len(cases)} editors, 18 checks passed")
