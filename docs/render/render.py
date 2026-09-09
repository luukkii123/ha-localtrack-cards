#!/usr/bin/env python3
"""Rendert localtrack-cards.js in echtem Chromium und protokolliert alle Netzanfragen.

Aufruf:  python3 render.py <pfad/localtrack-cards.js> <ausgabeordner> [breite]

Ersetzt `ha-card`/`ha-icon`/`ha-form` durch Attrappen, setzt einen erfundenen
`hass` ein und liefert die Datei über einen lokalen HTTP-Server aus — damit ein
etwaiger Nachladeversuch auf `/hacsfiles/.../vendor/...` als echter 404 sichtbar
würde. Nur so lässt sich behaupten, dass keiner stattfindet.

Seit 09.09.2026 misst derselbe Lauf zusätzlich `docs/ui-regeln.md`:

* **Regel 1 und 4** über `regeln.py` (`lauf_breiten` + `messe_text`) bei
  320, 480 und 960 px, jeweils hell und dunkel, dazu `selbsttest` als
  Falsifikation der Messung selbst.
* **Regel 2** als *Negativbefund mit Beleg*: die Karte hat keine Popups. Das
  wird nicht behauptet, sondern gemessen — jede anklickbare Stelle wird
  ausgelöst, danach wird gezählt, ob ein Leaflet-Popup, ein Tooltip oder ein
  Dialog entstanden ist und ob sich die Adresse geändert hat.

Auf diesem Server läuft Playwright nur im Container. Der Aufruf braucht
**beide** Mounts, `/work` (hacs/docs/render, wegen `regeln.py`) und `/cards`:

    docker run --rm \
      -v "/mnt/user/Data/Claude Projekte/hacs/docs/render:/work" \
      -v "/mnt/user/Data/Claude Projekte/hacs/ha-localtrack-cards:/cards" \
      --entrypoint bash mcr.microsoft.com/playwright/python:v1.62.0-noble \
      -c 'pip install --quiet --break-system-packages playwright==1.62.0 >/dev/null; \
          python3 /cards/docs/render/render.py /cards/dist/localtrack-cards.js \
                  /cards/docs/render/ergebnis 620'
"""
import json
import pathlib
import shutil
import subprocess
import sys
import time

from playwright.sync_api import sync_playwright

# `/work` ist der Mount von hacs/docs/render im Container; der zweite Pfad
# findet dasselbe Modul, wenn das Skript ausserhalb des Containers laeuft.
for _kandidat in ("/work",
                  str(pathlib.Path(__file__).resolve().parents[3] / "docs" / "render")):
    if _kandidat not in sys.path:
        sys.path.append(_kandidat)
from regeln import bewerte, lauf_breiten, messe_text, selbsttest, zaehle

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
</style>
<div id="wrap"></div>
<script>
  /* ── Attrappen für die Home-Assistant-Elemente ─────────────────────────── */
  /* ha-card MUSS einen eigenen Shadow-Root mit :host-Stil mitbringen. Die
     Karte rendert ihre ha-card INNERHALB ihres eigenen Shadow-Roots, und
     Dokument-CSS erreicht sie dort nicht: eine Regel `ha-card { display:block }`
     im <style> der Seite blieb wirkungslos, die ha-card war `display: inline`.
     Fuer messe_text ist das nicht kosmetisch — die ha-card ist das
     Bezugsrechteck von Regel 1, Pruefung 2. Werte wie beim echten ha-card. */
  class HaCard extends HTMLElement {
    constructor() {
      super();
      this.attachShadow({ mode: 'open' }).innerHTML =
        '<style>:host{display:block;box-sizing:border-box;' +
        'background:var(--ha-card-background,var(--card-background-color,#fff));' +
        'border-radius:var(--ha-card-border-radius,12px);' +
        'box-shadow:0 2px 6px rgba(0,0,0,.15);' +
        'color:var(--primary-text-color);}</style><slot></slot>';
    }
  }
  customElements.define('ha-card', HaCard);
  class HaIcon extends HTMLElement {
    static get observedAttributes() { return ['icon']; }
    connectedCallback() { this.style.display = 'inline-block';
      this.style.width = '24px'; this.style.height = '24px'; this.textContent = '◆'; }
  }
  customElements.define('ha-icon', HaIcon);
  /* Attrappe fuer ha-form: sie haelt genau den Vertrag ein, auf den der
     Editor sich stuetzt (hass/schema/data/computeLabel/computeHelper hinein).
     Damit ist die Verdrahtung belegt — NICHT, dass Home Assistants echtes
     ha-form diese Selektoren so darstellt. Das entscheidet der Live-Test. */
  class HaForm extends HTMLElement {
    set schema(v) { this._schema = v; window.__formSchema = v; }
    get schema() { return this._schema; }
    set data(v) { this._data = v; window.__formData = v; }
    get data() { return this._data; }
    set computeLabel(fn) { this._label = fn; window.__formLabel = fn; }
    set computeHelper(fn) { this._helper = fn; window.__formHelper = fn; }
  }
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
            // Standard-Marker + Layers-Control anlegen: beweist data:-URIs.
            // Beides gehoert NICHT zur Karte — die Handles bleiben liegen,
            // damit die Sonde vor den Bildern wieder abgeraeumt werden kann.
            const marker = L.marker(map.getCenter()).addTo(map);
            window.__sondeMarker = marker;
            window.__sondeLayers = L.control.layers({ 'OSM': map });
            window.__sondeLayers.addTo(map);
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
        # Die Sonde oben hat einen Standardmarker und ein Layers-Control in die
        # Landkarte gesetzt, um die data:-URIs zu belegen. Die Karte zeichnet
        # weder das eine noch das andere — auf einem Bild, das ins README
        # wandert, haetten sie nichts verloren (docs/karten.md: „Screenshots
        # immer gegenpruefen"). Also vor den Bildern wieder abraeumen.
        probe["sonde_abgeraeumt"] = page.evaluate("""() => {
            const map = window.__card._map;
            let weg = 0;
            if (window.__sondeMarker) { map.removeLayer(window.__sondeMarker); weg += 1; }
            if (window.__sondeLayers) { window.__sondeLayers.remove(); weg += 1; }
            return { entfernt: weg,
                     restMarkerIcons: window.__card.shadowRoot
                       .querySelectorAll('.leaflet-marker-icon').length,
                     restLayersControl: window.__card.shadowRoot
                       .querySelectorAll('.leaflet-control-layers').length };
        }""")
        page.wait_for_timeout(400)
        page.screenshot(path=str(OUT / "timeline-page.png"), full_page=True)
        page.locator("localtrack-timeline-card").screenshot(path=str(OUT / "timeline-card.png"))

        # ── Regel 3: Editor, beide Sprachen, Label UND Helper ──────────────
        # Gemessen wird der ausgelieferte Text, nicht die Existenz der
        # Funktionen: „es gibt ein Woerterbuch" belegt nicht, dass die Karte
        # danach greift.
        def editor_probe(sprache):
            return page.evaluate("""(sprache) => {
                const el = window.__card.constructor.getConfigElement();
                document.body.appendChild(el);
                el.setConfig({ type: 'custom:localtrack-timeline-card', entity: 'person.test' });
                el.hass = { ...window.__hass, locale: { language: sprache } };
                const out = {
                  tag: el.tagName.toLowerCase(),
                  felder: (window.__formSchema || []).map((s) => s.name),
                  beschriftungen: (window.__formSchema || []).map((s) => window.__formLabel(s)),
                  hilfetexte: (window.__formSchema || []).map((s) => window.__formHelper(s)),
                };
                el.remove();
                return out;
            }""", sprache)

        editor_de = editor_probe("de")
        editor_en = editor_probe("en")
        stub = page.evaluate("""() => {
            const c = window.__card.constructor;
            return { stub: c.getStubConfig(window.__hass),
                     cardSize: window.__card.getCardSize(),
                     gridOptions: window.__card.getGridOptions(),
                     customCards: (window.customCards || [])
                       .filter((e) => String(e.type).startsWith('localtrack-')) };
        }""")

        # ── Regel 2: Negativbefund mit Beleg ───────────────────────────────
        # Die Karte hat keine eigenen Popups. Statt das zu behaupten, wird
        # jede anklickbare Stelle einmal ausgeloest und danach gezaehlt, ob
        # ein Leaflet-Popup, ein Tooltip oder ein Dialog entstanden ist.
        url_vorher = page.url
        laenge_vorher = page.evaluate("() => history.length")
        popup = page.evaluate("""() => {
            const sr = window.__card.shadowRoot;
            const zaehlen = () => ({
              leaflet_popup: sr.querySelectorAll('.leaflet-popup').length,
              leaflet_tooltip: sr.querySelectorAll('.leaflet-tooltip').length,
              dialog: sr.querySelectorAll('dialog, [role="dialog"], ha-dialog').length,
              popup_pane_kinder: (sr.querySelector('.leaflet-popup-pane') || {children: []}).children.length,
            });
            const vorher = zaehlen();
            const klicks = [];
            for (const el of sr.querySelectorAll('.segment')) { el.click(); klicks.push('.segment'); }
            for (const el of sr.querySelectorAll('.leaflet-marker-icon')) {
              el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
              klicks.push('.leaflet-marker-icon');
            }
            for (const el of sr.querySelectorAll('.leaflet-overlay-pane path')) {
              el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
              klicks.push('route');
            }
            sr.querySelector('.map').dispatchEvent(new MouseEvent('click', { bubbles: true }));
            klicks.push('.map');
            return {
              vorher, klicks,
              marker_pointer_events: [...sr.querySelectorAll('.leaflet-marker-icon')]
                .map((el) => getComputedStyle(el).pointerEvents),
              overlay_sichtbar: getComputedStyle(sr.querySelector('.map-overlay')).display,
            };
        }""")
        page.wait_for_timeout(600)
        popup["nachher"] = page.evaluate("""() => {
            const sr = window.__card.shadowRoot;
            return {
              leaflet_popup: sr.querySelectorAll('.leaflet-popup').length,
              leaflet_tooltip: sr.querySelectorAll('.leaflet-tooltip').length,
              dialog: sr.querySelectorAll('dialog, [role="dialog"], ha-dialog').length,
              popup_pane_kinder: (sr.querySelector('.leaflet-popup-pane') || {children: []}).children.length,
            };
        }""")
        popup["url_unveraendert"] = page.url == url_vorher
        popup["history_length_unveraendert"] = (
            page.evaluate("() => history.length") == laenge_vorher)

        # ── Regel 1 und 4: 320/480/960 px, hell und dunkel ─────────────────
        def voll_breit(p):
            """Karte auf die volle Ansichtsfensterbreite bringen und Leaflet
            die neue Groesse mitteilen. Ohne invalidateSize misst man das
            alte Kartenbild in einem neuen Rahmen."""
            p.evaluate("""() => {
                document.body.style.padding = '0';
                const wrap = document.getElementById('wrap');
                wrap.style.maxWidth = 'none';
                wrap.style.width = '100%';
                if (window.__card && window.__card._map) window.__card._map.invalidateSize();
            }""")

        page.set_viewport_size({"width": 480, "height": 1200})
        voll_breit(page)
        page.wait_for_timeout(600)
        regel1_selbsttest = selbsttest(page, "localtrack-timeline-card")
        regel1 = lauf_breiten(
            page,
            messung=lambda p: messe_text(p, "localtrack-timeline-card"),
            vor_messung=voll_breit,
        )

        # ── Regel 1 im Fehlerzustand ───────────────────────────────────────
        # Im Normallauf steht die Lade- und Fehlerbox auf display:none und
        # bliebe damit ungemessen — ausgerechnet sie traegt aber den laengsten
        # Text der Karte. Also einmal mit dem laengsten Text messen, in beiden
        # Themen und bei allen drei Breiten.
        def fehlerzustand(p):
            voll_breit(p)
            p.evaluate("""() => {
                const c = window.__card;
                c._showStatus(c._t.nicht_eingerichtet);
            }""")

        regel1_fehlerzustand = lauf_breiten(
            page,
            messung=lambda p: messe_text(p, "localtrack-timeline-card"),
            vor_messung=fehlerzustand,
        )
        page.evaluate("() => window.__card._showStatus('')")

        # ── Regel 4: je ein Bild pro Thema bei 320 px ──────────────────────
        # Die Zahlen oben belegen Lage und Groesse, nicht Lesbarkeit. Schrift
        # in Hintergrundfarbe faellt in keiner Messung auf — die sieht man nur
        # am Bild (hacs/CLAUDE.md, „Behauptungen belegen").
        bilder = []

        def bild(p):
            thema = p.evaluate("() => document.documentElement.dataset.theme")
            name = "timeline-320-%s.png" % thema
            p.locator("localtrack-timeline-card").screenshot(path=str(OUT / name))
            bilder.append(name)
            return {"bild": name}

        lauf_breiten(page, breiten=(320,), messung=bild, vor_messung=voll_breit)
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
    "regel1": regel1,
    "regel1_selbsttest": regel1_selbsttest,
    "regel1_zaehlung": zaehle(regel1),
    "regel1_fehlerzustand": regel1_fehlerzustand,
    "regel1_fehlerzustand_zaehlung": zaehle(regel1_fehlerzustand),
    "regel2_popups": popup,
    "regel3_editor_de": editor_de,
    "regel3_editor_en": editor_en,
    "regel3_karte": stub,
    "regel4_bilder": bilder,
}

# ── Urteil ──────────────────────────────────────────────────────────────────
checks = {
    "keine Konsolenfehler": report["console_errors"] == [],
    "keine Seitenfehler": report["page_errors"] == [],
    "kein Nachladeversuch auf vendor/hacsfiles": report["vendor_requests"] == [],
    "keine Antwort ab 400": report["bad_responses"] == [],
    # Regel 1: die Messung selbst muss zuerst beweisen, dass sie anschlaegt.
    "Selbsttest: Ueberlauf wird erkannt": regel1_selbsttest["ueberlauf_erkannt"],
    "Selbsttest: ausserhalb wird erkannt": regel1_selbsttest["ausserhalb_erkannt"],
    "Selbsttest: gewollte Kuerzung gilt nicht als Ueberlauf":
        regel1_selbsttest["ellipsis_nicht_gemeldet"],
    "Regel 1: kein Ueberlauf": report["regel1_zaehlung"]["ueberlauf"] == 0,
    "Regel 1: nichts ausserhalb der Karte": report["regel1_zaehlung"]["ausserhalb"] == 0,
    "Regel 1: keine Ueberlappung": report["regel1_zaehlung"]["ueberlappung"] == 0,
    "Regel 1: sechs Laeufe (3 Breiten x 2 Themen)": len(regel1["laeufe"]) == 6,
    "Regel 1: in jedem Lauf wurde etwas gemessen":
        all(l["messung"].get("geprueft", 0) > 0 for l in regel1["laeufe"]),
    "Regel 1 (Fehlerzustand): kein Ueberlauf":
        report["regel1_fehlerzustand_zaehlung"]["ueberlauf"] == 0,
    "Regel 1 (Fehlerzustand): nichts ausserhalb der Karte":
        report["regel1_fehlerzustand_zaehlung"]["ausserhalb"] == 0,
    "Regel 1 (Fehlerzustand): keine Ueberlappung":
        report["regel1_fehlerzustand_zaehlung"]["ueberlappung"] == 0,
    "Regel 1 (Fehlerzustand): die Fehlerbox wurde wirklich gemessen":
        all(any(".map-overlay" in s for s in l["messung"].get("geprueft_liste", []))
            for l in regel1_fehlerzustand["laeufe"]),
    # Regel 2: kein Popup entsteht, auch nicht nach jedem Klick.
    "Regel 2: kein Leaflet-Popup vor den Klicks": popup["vorher"]["leaflet_popup"] == 0,
    "Regel 2: kein Leaflet-Popup nach den Klicks": popup["nachher"]["leaflet_popup"] == 0,
    "Regel 2: kein Tooltip nach den Klicks": popup["nachher"]["leaflet_tooltip"] == 0,
    "Regel 2: kein Dialog nach den Klicks": popup["nachher"]["dialog"] == 0,
    "Regel 2: Popup-Ebene bleibt leer": popup["nachher"]["popup_pane_kinder"] == 0,
    "Regel 2: die Klicks kamen wirklich an": len(popup["klicks"]) > 0,
    "Regel 2: Adresse unveraendert": popup["url_unveraendert"],
    "Regel 2: kein verwaister Verlaufseintrag": popup["history_length_unveraendert"],
    # Regel 3: jedes Schemafeld hat Label und Helper, in beiden Sprachen.
    "Regel 3: neun Schemafelder": len(editor_de["felder"]) == 9,
    "Regel 3: zu jedem Feld ein deutsches Label":
        all(bool(x) and x != n for x, n in zip(editor_de["beschriftungen"], editor_de["felder"])),
    "Regel 3: zu jedem Feld ein englisches Label":
        all(bool(x) and x != n for x, n in zip(editor_en["beschriftungen"], editor_en["felder"])),
    "Regel 3: jeder deutsche Helper ist ein Satz mit Punkt":
        all(bool(x) and x.strip().endswith(".") for x in editor_de["hilfetexte"]),
    "Regel 3: jeder englische Helper ist ein Satz mit Punkt":
        all(bool(x) and x.strip().endswith(".") for x in editor_en["hilfetexte"]),
    "Regel 3: die Sprachen unterscheiden sich wirklich":
        editor_de["beschriftungen"] != editor_en["beschriftungen"]
        and editor_de["hilfetexte"] != editor_en["hilfetexte"],
    "Regel 3: kein Label endet auf einen Punkt":
        all(not x.strip().endswith(".") for x in
            editor_de["beschriftungen"] + editor_en["beschriftungen"]),
    "Regel 3: getStubConfig liefert eine Entitaet": bool(stub["stub"].get("entity")),
    "Regel 3: getGridOptions in Vielfachen von 3":
        stub["gridOptions"]["columns"] % 3 == 0 and stub["gridOptions"]["min_columns"] % 3 == 0,
    "Regel 3: beide customCards-Eintraege vollstaendig":
        len(stub["customCards"]) == 2 and all(
            all(e.get(f) for f in ("type", "name", "description", "documentationURL"))
            and e.get("preview") is True for e in stub["customCards"]),
}
report["pruefungen"] = checks
report["bestanden"] = all(checks.values()) and bewerte(report) == 0
report["gescheitert"] = [k for k, v in checks.items() if not v]

(OUT / "report.json").write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
print(json.dumps({"bestanden": report["bestanden"],
                  "gescheitert": report["gescheitert"],
                  "regel1_zaehlung": report["regel1_zaehlung"],
                  "bewerte": bewerte(report)}, indent=2, ensure_ascii=False))
if not report["bestanden"]:
    print(json.dumps(report, indent=2, ensure_ascii=False)[:12000])
sys.exit(0 if report["bestanden"] else 1)
