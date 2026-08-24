#!/usr/bin/env python3
"""Rendert localtrack-cards.js in echtem Chromium und protokolliert alle Netzanfragen.

Aufruf:  python3 render.py <pfad/localtrack-cards.js> <ausgabeordner> [breite]

Ersetzt `ha-card`/`ha-icon`/`ha-form` durch Attrappen, setzt einen erfundenen
`hass` ein und liefert die Datei über einen lokalen HTTP-Server aus — damit ein
etwaiger Nachladeversuch auf `/hacsfiles/.../vendor/...` als echter 404 sichtbar
würde. Nur so lässt sich behaupten, dass keiner stattfindet.

Auf diesem Server läuft Playwright nur im Container:

    docker run --rm -v "$PWD:/repo" \
      --entrypoint bash mcr.microsoft.com/playwright/python:v1.62.0-noble \
      -c 'pip install --quiet --break-system-packages playwright==1.62.0 >/dev/null; \
          python3 /repo/docs/render/render.py /repo/dist/localtrack-cards.js \
                  /repo/docs/render/ergebnis 620'
"""
import json
import pathlib
import shutil
import subprocess
import sys
import time

from playwright.sync_api import sync_playwright

JS = pathlib.Path(sys.argv[1])
OUT = pathlib.Path(sys.argv[2])
WIDTH = int(sys.argv[3]) if len(sys.argv) > 3 else 620
OUT.mkdir(parents=True, exist_ok=True)
SERVE = OUT / "serve"
SERVE.mkdir(exist_ok=True)
shutil.copy(JS, SERVE / "localtrack-cards.js")
PORT = 8099

PAGE = """<!doctype html>
<meta charset="utf-8">
<title>localtrack-cards render</title>
<style>
  /* Die Karte nutzt ausschließlich HA-eigene CSS-Variablen. Ohne sie bliebe
     die Segmentliste farblos — das wäre ein Fehler der Attrappe, nicht der
     Karte. Werte aus dem hellen Standardtheme von Home Assistant. */
  :root {
    --primary-color: #03a9f4;
    --accent-color: #ff9800;
    --primary-text-color: #212121;
    --secondary-text-color: #727272;
    --disabled-text-color: #bdbdbd;
    --divider-color: #e0e0e0;
    --error-color: #db4437;
    --card-background-color: #fff;
    --ha-card-background: #fff;
    --secondary-background-color: #e5e5e5;
    --text-primary-color: #fff;
  }
  body { margin: 0; padding: 16px; background: #f2f4f7; font-family: Roboto, sans-serif;
         color: var(--primary-text-color); }
  #wrap { max-width: __MAXW__px; margin: 0 auto; }
  ha-card { display: block; background: #fff; border-radius: 12px; padding: 16px;
            box-shadow: 0 2px 6px rgba(0,0,0,.15); }
</style>
<div id="wrap"></div>
<script>
  /* ── Attrappen für die Home-Assistant-Elemente ─────────────────────────── */
  class HaCard extends HTMLElement {
    connectedCallback() { if (this.header && !this.querySelector('.hdr')) {
      const h = document.createElement('div'); h.className = 'hdr';
      h.style.cssText = 'font-size:1.3em;padding:8px 0;'; h.textContent = this.header;
      this.prepend(h); } }
  }
  customElements.define('ha-card', HaCard);
  class HaIcon extends HTMLElement {
    static get observedAttributes() { return ['icon']; }
    connectedCallback() { this.style.display = 'inline-block';
      this.style.width = '24px'; this.style.height = '24px'; this.textContent = '◆'; }
  }
  customElements.define('ha-icon', HaIcon);
  class HaForm extends HTMLElement {}
  customElements.define('ha-form', HaForm);

  /* ── erfundener hass ───────────────────────────────────────────────────── */
  const day = new Date(); day.setHours(0, 0, 0, 0);
  const at = (h, m) => Math.round((day.getTime() + (h * 60 + m) * 60000) / 1000);
  const HOME = [52.5163, 13.3777];          // Brandenburger Tor
  const WORK = [52.5219, 13.4132];          // Alexanderplatz
  const points = [];
  // Aufenthalt „Zuhause" 08:00–09:00
  for (let i = 0; i <= 12; i++)
    points.push({ ts: at(8, i * 5), lat: HOME[0] + (i % 3) * 0.00012, lon: HOME[1] + (i % 2) * 0.00012 });
  // Strecke 09:00–09:30
  for (let i = 1; i < 12; i++)
    points.push({ ts: at(9, i * 2.5),
      lat: HOME[0] + (WORK[0] - HOME[0]) * (i / 12),
      lon: HOME[1] + (WORK[1] - HOME[1]) * (i / 12) + 0.0009 * Math.sin(i) });
  // Aufenthalt „Arbeit" 09:30–12:00
  for (let i = 0; i <= 30; i++)
    points.push({ ts: at(9, 30 + i * 5), lat: WORK[0] + (i % 4) * 0.0001, lon: WORK[1] + (i % 3) * 0.0001 });
  // Rückweg 12:00–12:30
  for (let i = 1; i <= 12; i++)
    points.push({ ts: at(12, i * 2.5),
      lat: WORK[0] + (HOME[0] - WORK[0]) * (i / 12),
      lon: WORK[1] + (HOME[1] - WORK[1]) * (i / 12) - 0.0011 * Math.sin(i) });
  // Aufenthalt „Zuhause" 12:30–15:00
  for (let i = 0; i <= 30; i++)
    points.push({ ts: at(12, 30 + i * 5), lat: HOME[0] + (i % 3) * 0.00011, lon: HOME[1] - (i % 2) * 0.00011 });

  window.__wsCalls = [];
  const hass = {
    locale: { language: 'de' },
    states: {
      'person.test': { entity_id: 'person.test', state: 'home',
        last_updated: new Date().toISOString(),
        attributes: { friendly_name: 'Testperson', latitude: HOME[0], longitude: HOME[1] } },
      'zone.home': { entity_id: 'zone.home', state: 'zoning',
        attributes: { friendly_name: 'Zuhause', latitude: HOME[0], longitude: HOME[1], radius: 120 } },
      'zone.work': { entity_id: 'zone.work', state: 'zoning',
        attributes: { friendly_name: 'Arbeit', latitude: WORK[0], longitude: WORK[1], radius: 150 } },
    },
    callWS(msg) {
      window.__wsCalls.push(msg);
      if (msg.type === 'localtrack/history') return Promise.resolve({ points });
      return Promise.reject({ code: 'unknown_command' });
    },
    callService() { return Promise.resolve(); },
  };
  window.__hass = hass;
</script>
<script src="/localtrack-cards.js"></script>
<script>
  window.__ready = (async () => {
    const card = document.createElement('localtrack-timeline-card');
    card.setConfig({ type: 'custom:localtrack-timeline-card', entity: 'person.test',
                     title: 'Timeline — Testperson', height: 340, show_scrubber: true });
    document.getElementById('wrap').appendChild(card);
    card.hass = window.__hass;
    window.__card = card;
    return true;
  })();
</script>
"""
PAGE = PAGE.replace("__MAXW__", str(WIDTH - 60))
(SERVE / "page.html").write_text(PAGE, encoding="utf-8")

server = subprocess.Popen(
    [sys.executable, "-m", "http.server", str(PORT), "--directory", str(SERVE)],
    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
)
time.sleep(1.5)

requests, responses, failures, console, errors = [], [], [], [], []
try:
    with sync_playwright() as pw:
        browser = pw.chromium.launch(args=["--no-sandbox"])
        page = browser.new_page(viewport={"width": WIDTH, "height": 900},
                                device_scale_factor=2, locale="de-DE")
        page.on("request", lambda r: requests.append(r.url))
        page.on("response", lambda r: responses.append((r.status, r.url)))
        page.on("requestfailed", lambda r: failures.append((r.url, r.failure)))
        page.on("console", lambda m: console.append((m.type, m.text)))
        page.on("pageerror", lambda e: errors.append(str(e)))

        page.goto(f"http://127.0.0.1:{PORT}/page.html", wait_until="load")
        page.wait_for_function("window.__card && window.__card._map", timeout=20000)
        page.wait_for_function(
            "window.__card.shadowRoot.querySelectorAll('.segment').length > 0", timeout=20000)
        page.wait_for_timeout(4000)   # Kacheln laden lassen

        probe = page.evaluate("""() => {
            const card = window.__card;
            const sr = card.shadowRoot;
            const L = card._leaflet;
            const map = card._map;
            // Standard-Marker + Layers-Control anlegen: beweist data:-URIs
            const marker = L.marker(map.getCenter()).addTo(map);
            L.control.layers({ 'OSM': map }).addTo(map);
            const img = sr.querySelector('img.leaflet-marker-icon');
            const shadow = sr.querySelector('img.leaflet-marker-shadow');
            const toggle = sr.querySelector('.leaflet-control-layers-toggle');
            const bg = toggle ? getComputedStyle(toggle).backgroundImage : '';
            return {
              leafletVersion: L.version,
              windowL: !!window.L,
              iconOptions: L.Icon.Default.prototype.options,
              markerImgSrc: img ? img.src.slice(0, 40) : null,
              markerImgComplete: img ? (img.complete && img.naturalWidth > 0) : null,
              shadowImgSrc: shadow ? shadow.src.slice(0, 40) : null,
              shadowImgOk: shadow ? (shadow.complete && shadow.naturalWidth > 0) : null,
              layersToggleBg: bg.slice(0, 40),
              headStyle: !!document.getElementById('localtrack-leaflet-css'),
              headStyleTag: (document.getElementById('localtrack-leaflet-css') || {}).tagName,
              shadowStyleCount: sr.querySelectorAll('style').length,
              shadowLinkCount: sr.querySelectorAll('link').length,
              segments: sr.querySelectorAll('.segment').length,
              segmentText: [...sr.querySelectorAll('.segment')].map(s => s.textContent.replace(/\\s+/g, ' ').trim()),
              divPins: sr.querySelectorAll('.leaflet-marker-icon').length,
              circleMarkers: sr.querySelectorAll('.leaflet-overlay-pane path').length,
              tiles: sr.querySelectorAll('img.leaflet-tile').length,
              tilesLoaded: [...sr.querySelectorAll('img.leaflet-tile')].filter(t => t.complete && t.naturalWidth > 0).length,
              mapSize: [map.getSize().x, map.getSize().y],
              overlay: sr.querySelector('.map-overlay').style.display,
              scrubLabel: sr.querySelector('.scrub-label').textContent,
              wsCalls: window.__wsCalls.map(c => c.type),
              cardTag: card.tagName.toLowerCase(),
              editorTag: (card.constructor.getConfigElement
                          ? card.constructor.getConfigElement().tagName.toLowerCase() : null),
            };
        }""")
        page.wait_for_timeout(1500)
        # data:-Bilder brauchen einen Tick zum Dekodieren — jetzt erst prüfen.
        probe.update(page.evaluate("""() => {
            const sr = window.__card.shadowRoot;
            const img = sr.querySelector('img.leaflet-marker-icon[src^="data:"]');
            const shadow = sr.querySelector('img.leaflet-marker-shadow');
            return {
              markerImgComplete: img ? (img.complete && img.naturalWidth > 0) : null,
              markerImgNatural: img ? [img.naturalWidth, img.naturalHeight] : null,
              shadowImgOk: shadow ? (shadow.complete && shadow.naturalWidth > 0) : null,
              shadowImgNatural: shadow ? [shadow.naturalWidth, shadow.naturalHeight] : null,
            };
        }"""))
        page.screenshot(path=str(OUT / "timeline-page.png"), full_page=True)
        page.locator("localtrack-timeline-card").screenshot(path=str(OUT / "timeline-card.png"))
        browser.close()
finally:
    server.terminate()

report = {
    "requests": requests,
    "vendor_requests": [u for u in requests if "/vendor/" in u or "hacsfiles" in u],
    "bad_responses": [r for r in responses if r[0] >= 400],
    "request_failures": failures,
    "console_errors": [c for c in console if c[0] == "error"],
    "page_errors": errors,
    "probe": probe,
}
(OUT / "report.json").write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
print(json.dumps(report, indent=2, ensure_ascii=False)[:6000])
