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

Seit #1304 (M21) dazu die Variante **mapcard**: busch-map-card aus
`busch-cards/dist/busch-cards.js` und die Timeline auf einer Seite, beide
Ladereihenfolgen. Belegt, dass das Laden kein Leaflet auswertet und beide
Karten eine Instanz teilen (Bilder `mapcard-localtrack-zuerst.png`,
`mapcard-busch-zuerst.png`). Ohne busch-cards-Buendel neben diesem Repo
(oder `LOCALTRACK_BUSCH_BUNDLE`) ist der Lauf rot.

Seit #1304 (M53) ausserdem **picker-preview**: beide Karten wie in HAs
Kartenwaehler (`div.preview` im Schatten von `hui-card-picker`). Belegt die
statische Vorschau ohne WebSocket-, Kachel- und Nominatim-Abruf (Bilder
`picker-preview.png`, `picker-preview-390.png`).

Seit Buschcheck M56 misst der Lauf den **Zeitregler**: gestaltet (Schiene und
Daumen aus `--primary-color`), 44 px hoch, im Bild der Karte, sichtbar mit
„Uhrzeit“ beschriftet, Pfeiltasten bedienen ihn, `aria-valuetext` folgt dem Wert;
dazu die Tageswahl mit Beschriftung, `lang` und Vor/Zurück (Bild
`timeline-scrubber.png`).

Seit #1304 (M51) dazu **stale-loading**: Tageswechsel mit haengender Antwort,
der bisherige Tag bleibt gedimmt mit `aria-busy` stehen, der Ladehinweis liegt
durchscheinend ueber der Karte (Bilder `timeline-320-light-stale-loading.png`,
`timeline-320-dark-stale-loading.png`).

Auf diesem Server läuft Playwright nur im Container. Der Aufruf braucht
**beide** Mounts, `/work` (hacs/docs/render, wegen `regeln.py`) und `/cards`:
(`HACS_DIR` = Pfad des hacs-Ordners auf dem Server)

    docker run --rm \
      -v "$HACS_DIR/docs/render:/work" \
      -v "$HACS_DIR/ha-localtrack-cards:/cards" \
      --entrypoint bash mcr.microsoft.com/playwright/python:v1.62.0-noble \
      -c 'pip install --quiet --break-system-packages playwright==1.62.0 >/dev/null; \
          python3 /cards/docs/render/render.py /cards/dist/localtrack-cards.js \
                  /cards/docs/render/ergebnis 620'
"""
import json
import os
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

# Variante „mapcard" (#1304, M21): busch-map-card aus busch-cards und die
# Timeline auf EINER Seite. Das busch-cards-Buendel liegt im Runner neben
# diesem Repo (/hacs/busch-cards/...); LOCALTRACK_BUSCH_BUNDLE ueberschreibt.
BUSCH_JS = pathlib.Path(os.environ.get(
    "LOCALTRACK_BUSCH_BUNDLE",
    str(JS.resolve().parents[2] / "busch-cards" / "dist" / "busch-cards.js")))
if BUSCH_JS.exists():
    shutil.copy(BUSCH_JS, SERVE / "busch-cards.js")

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
      /* Variante stale-loading (M51): ein Tagesabruf haengt, bis die
         Messung ihn freigibt. */
      if (msg.type === 'localtrack/history' && window.__hangHistory) {
        return new Promise((resolve) => window.__heldHistory.push(() => resolve({ points })));
      }
      if (msg.type === 'localtrack/history') return Promise.resolve({ points });
      return Promise.reject({ code: 'unknown_command' });
    },
    callService() { return Promise.resolve(); },
  };
  window.__hangHistory = false;
  window.__heldHistory = [];
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

# ── Variante „mapcard": beide Leaflet-Karten auf einer Seite ───────────────
# Beide Buendel laden wie in Home Assistant als Module (eigener Gueltigkeits-
# bereich je Datei), in der Reihenfolge der Seite. Seit M21 wertet KEINES von
# beiden Leaflet beim Laden aus; wer zuerst eine Karte baut, setzt window.L,
# die andere Karte nutzt genau diese Instanz mit. Die eingebaute Map-Karte ist
# wie in busch-cards/docs/render/mapcard.py (Modus „stubKarte") nachgebaut:
# ein ha-map ohne Rasterebene, damit busch-map-card ihr Leaflet braucht.
MAPCARD_PAGE = """<!doctype html>
<meta charset="utf-8">
<title>mapcard</title>
<style>
  :root { --primary-color:#03a9f4; --primary-text-color:#212121; --secondary-text-color:#727272;
          --divider-color:#e0e0e0; --card-background-color:#fff; --error-color:#db4437;
          --secondary-background-color:#e5e5e5; --text-primary-color:#fff; }
  body { margin:0; padding:16px; background:#f2f4f7; font-family:Roboto,sans-serif; }
  #wrap { max-width:560px; margin:0 auto; }
  #wrap > * { display:block; margin-bottom:16px; }
</style>
<div id="wrap"></div>
<script>
  customElements.define('ha-card', class extends HTMLElement {
    constructor() { super(); this.attachShadow({ mode: 'open' }).innerHTML =
      '<style>:host{display:block;background:#fff;border-radius:12px}</style><slot></slot>'; }
  });
  customElements.define('ha-icon', class extends HTMLElement {});
  customElements.define('ha-form', class extends HTMLElement {});
  customElements.define('ha-map', class extends HTMLElement {});
  customElements.define('fake-map-card', class extends HTMLElement {
    constructor() { super(); this.attachShadow({ mode: 'open' }); }
    setConfig(c) { this._config = c; }
    set hass(h) { this._hass = h; }
    getCardSize() { return 7; }
    connectedCallback() {
      if (this._gebaut) return;
      this._gebaut = true;
      this.shadowRoot.innerHTML = '<ha-map style="display:block;height:200px"></ha-map>';
      const panes = {};
      const haMap = this.shadowRoot.querySelector('ha-map');
      haMap.leafletMap = {
        _hinzugefuegt: [],
        eachLayer() {},
        getPane(n) { return panes[n]; },
        createPane(n) { panes[n] = { style: {} }; return panes[n]; },
        addLayer(l) { this._hinzugefuegt.push(l); return this; },
        removeLayer() { return this; },
      };
      window.__stubMap = haMap.leafletMap;
    }
  });
  window.loadCardHelpers = async () => ({
    createCardElement: async (config) => {
      const el = document.createElement('fake-map-card'); el.setConfig(config); return el;
    },
  });
  const t0 = Math.round(new Date().setHours(9, 0, 0, 0) / 1000);
  const points = [];
  for (let i = 0; i <= 20; i++) points.push({ ts: t0 + i * 60, lat: 52.5163, lon: 13.3777 });
  window.__wsCalls = [];
  window.__hass = {
    locale: { language: 'de' }, themes: { darkMode: false },
    states: {
      'person.test': { entity_id: 'person.test', state: 'home', last_updated: new Date().toISOString(),
        attributes: { friendly_name: 'Testperson', latitude: 52.5163, longitude: 13.3777 } },
      'zone.home': { entity_id: 'zone.home', state: '1',
        attributes: { friendly_name: 'Zuhause', latitude: 52.5163, longitude: 13.3777, radius: 120 } },
    },
    callWS(msg) {
      window.__wsCalls.push(msg.type);
      if (msg.type === 'localtrack/history') return Promise.resolve({ points });
      return Promise.resolve({});
    },
    callService() { return Promise.resolve(); },
  };
  window.__nachLaden = null;
</script>
__MODULE__
<script type="module">
  // Module laufen in Dokumentreihenfolge: dieses hier nach beiden Buendeln.
  window.__nachLaden = { windowL: !!window.L, leafletGlobal: !!window.leaflet };
  const warte = async (fn, ms = 15000) => {
    const ende = Date.now() + ms;
    while (Date.now() < ende) { if (fn()) return true; await new Promise(r => setTimeout(r, 50)); }
    return false;
  };
  const timeline = async () => {
    const card = document.createElement('localtrack-timeline-card');
    card.setConfig({ type: 'custom:localtrack-timeline-card', entity: 'person.test', height: 240 });
    document.getElementById('wrap').appendChild(card);
    card.hass = window.__hass;
    window.__timeline = card;
    return warte(() => card._map && card.shadowRoot.querySelector('.leaflet-container'));
  };
  const mapcard = async () => {
    const card = document.createElement('busch-map-card');
    card.setConfig({ type: 'custom:busch-map-card', entities: ['person.test'], map_style: 'osm' });
    document.getElementById('wrap').appendChild(card);
    card.hass = window.__hass;
    return warte(() => window.__stubMap && window.__stubMap._hinzugefuegt.length > 0);
  };
  window.__lauf = async (zuerst) => {
    const schritte = zuerst === 'localtrack' ? [timeline, mapcard] : [mapcard, timeline];
    const erste = await schritte[0]();
    const erstesL = window.L || null;
    const zweite = await schritte[1]();
    const ebene = window.__stubMap && window.__stubMap._hinzugefuegt[0];
    const L = window.L;
    return {
      zuerst, nachLaden: window.__nachLaden, erste, zweite,
      version: L && L.version,
      windowLUnveraendert: !!erstesL && L === erstesL,
      timelineNutztWindowL: !!window.__timeline && window.__timeline._leaflet === L,
      ebeneAusDerselbenInstanz: !!(ebene && L && ebene instanceof L.TileLayer),
      kacheln: window.__timeline ? window.__timeline.shadowRoot.querySelectorAll('img.leaflet-tile').length : 0,
      wsCalls: window.__wsCalls,
    };
  };
</script>
"""
# ── Variante „picker-preview" (#1304, M53): HAs Kartenwaehler ─────────────
# Wie `hui-card-picker.ts`: Karte erzeugen, setConfig mit getStubConfig, hass
# setzen, dann in ein `div.preview` IM Schatten von hui-card-picker haengen.
# Erwartet: statische Vorschau, kein WS-Aufruf, keine Kachel, kein Nominatim.
PICKER_PAGE = """<!doctype html>
<meta charset="utf-8">
<title>picker-preview</title>
<style>
  :root { --primary-color:#03a9f4; --primary-text-color:#212121; --secondary-text-color:#727272;
          --disabled-text-color:#bdbdbd; --divider-color:#e0e0e0; --card-background-color:#fff;
          --error-color:#db4437; --success-color:#4caf50; --secondary-background-color:#e5e5e5;
          --text-primary-color:#fff; }
  body { margin:0; padding:16px; background:#f2f4f7; font-family:Roboto,sans-serif; }
</style>
<hui-card-picker></hui-card-picker>
<script>
  customElements.define('ha-card', class extends HTMLElement {
    constructor() { super(); this.attachShadow({ mode: 'open' }).innerHTML =
      '<style>:host{display:block;background:var(--card-background-color);border-radius:12px;' +
      'color:var(--primary-text-color)}</style><slot></slot>'; }
  });
  customElements.define('ha-icon', class extends HTMLElement {});
  customElements.define('ha-form', class extends HTMLElement {});
  customElements.define('hui-card-picker', class extends HTMLElement {
    constructor() {
      super();
      this.attachShadow({ mode: 'open' }).innerHTML =
        '<style>.cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:12px}' +
        '.card{background:#fff;border-radius:12px;overflow:hidden;position:relative}' +
        '.card-header{padding:12px 16px;font-weight:500}' +
        '.preview{pointer-events:none;margin:0 16px 16px;max-height:420px;overflow:hidden}</style>' +
        '<div class="cards"></div>';
    }
  });
  window.__wsCalls = [];
  window.__hass = {
    locale: { language: 'de' }, themes: { darkMode: false }, entities: {},
    states: {
      'person.test': { entity_id: 'person.test', state: 'home', last_updated: new Date().toISOString(),
        attributes: { friendly_name: 'Testperson', latitude: 52.5163, longitude: 13.3777 } },
      'zone.home': { entity_id: 'zone.home', state: '1',
        attributes: { friendly_name: 'Zuhause', latitude: 52.5163, longitude: 13.3777, radius: 120 } },
      'zone.work': { entity_id: 'zone.work', state: '0',
        attributes: { friendly_name: 'Arbeit', latitude: 52.5219, longitude: 13.4132, radius: 150 } },
    },
    callWS(msg) { window.__wsCalls.push(msg.type); return new Promise(() => {}); },
    callService() { return Promise.resolve(); },
  };
</script>
<script type="module" src="/localtrack-cards.js"></script>
<script type="module">
  const picker = document.querySelector('hui-card-picker');
  const liste = picker.shadowRoot.querySelector('.cards');
  window.__karten = [];
  for (const eintrag of window.customCards.filter((e) => e.type.startsWith('localtrack-'))) {
    const Klasse = customElements.get(eintrag.type);
    const karte = document.createElement(eintrag.type);
    karte.setConfig(Klasse.getStubConfig(window.__hass));
    karte.hass = window.__hass;
    karte.tabIndex = -1;
    const kasten = document.createElement('div');
    kasten.className = 'card';
    const kopf = document.createElement('div');
    kopf.className = 'card-header';
    kopf.textContent = eintrag.name;
    const vorschau = document.createElement('div');
    vorschau.className = 'preview';
    vorschau.appendChild(karte);
    kasten.append(kopf, vorschau);
    liste.appendChild(kasten);
    window.__karten.push(karte);
  }
  window.__pickerFertig = true;
</script>
"""
(SERVE / "picker-preview.html").write_text(PICKER_PAGE, encoding="utf-8")

for _name, _reihe in (("mapcard-localtrack.html", ("localtrack-cards.js", "busch-cards.js")),
                      ("mapcard-busch.html", ("busch-cards.js", "localtrack-cards.js"))):
    (SERVE / _name).write_text(MAPCARD_PAGE.replace("__MODULE__", "\n".join(
        '<script type="module" src="/%s"></script>' % datei for datei in _reihe)), encoding="utf-8")

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

        # ── Zeitregler und Tageswahl (M56) ─────────────────────────────────
        # Gemessen, nicht nur abgebildet: der Schieber ist gestaltet (kein
        # Browser-Standard, Schiene und Daumen aus --primary-color), 44 px
        # hoch, liegt ganz im Bild der Karte und traegt eine sichtbare
        # Beschriftung ueber sich. Pfeiltaste rechts schiebt ihn einen
        # Schritt weiter, aria-valuetext folgt dem sichtbaren Wert. Die
        # Tageswahl hat Beschriftung und Vor/Zurueck mit Namen und 44 px.
        def schieber_messen():
            return page.evaluate("""() => {
                const card = window.__card, sr = card.shadowRoot;
                const range = sr.querySelector('.scrubber input[type=range]');
                const name = sr.querySelector('.scrubber .scrub-name');
                const wert = sr.querySelector('.scrubber .scrub-label');
                const r = (el) => el.getBoundingClientRect();
                const karte = r(sr.querySelector('ha-card'));
                const rr = r(range), nr = r(name), wr = r(wert);
                const regeln = [...sr.styleSheets].flatMap((sheet) => [...sheet.cssRules])
                  .filter((rule) => (rule.selectorText || '').includes('input[type="range"]'));
                const regel = (pseudo) => regeln.find((rule) => rule.selectorText.endsWith(pseudo));
                const daumen = regel('::-webkit-slider-thumb');
                const schiene = regel('::-webkit-slider-runnable-track');
                const knopf = (sel) => { const b = sr.querySelector(sel), br = r(b);
                  return { name: b.getAttribute('aria-label'), typ: b.type,
                           breite: br.width, hoehe: br.height }; };
                return {
                  appearance: getComputedStyle(range).appearance,
                  hoehe: rr.height,
                  imBild: rr.left >= karte.left - 0.5 && rr.right <= karte.right + 0.5
                    && rr.top >= karte.top - 0.5 && rr.bottom <= karte.bottom + 0.5 && rr.width > 0,
                  daumenPrimaer: !!daumen && daumen.style.background.includes('--primary-color'),
                  schienePrimaer: !!schiene && schiene.style.background.includes('--primary-color'),
                  beschriftung: name.textContent.trim(),
                  beschriftungFuer: name.htmlFor === range.id && !!range.id,
                  beschriftungSichtbar: nr.width > 0 && nr.height > 0
                    && getComputedStyle(name).visibility !== 'hidden',
                  beschriftungUeberSchieber: nr.bottom <= rr.top + 1 && wr.bottom <= rr.top + 1,
                  ariaLabel: range.getAttribute('aria-label'),
                  wert: wert.textContent,
                  valuetext: range.getAttribute('aria-valuetext'),
                  value: Number(range.value),
                  tagBeschriftung: sr.querySelector('.controls .day-name').textContent.trim(),
                  tagFuer: sr.querySelector('.controls .day-name').htmlFor === card._dateEl.id,
                  datumLang: card._dateEl.getAttribute('lang'),
                  zurueck: knopf('.day-prev'), vor: knopf('.day-next'),
                  // Bildpruefung 19.11.: the focus ring (outline + offset) of the focused
                  // slider must stay below the caption row; the image clip covers both.
                  fokussiert: sr.activeElement === range,
                  ringFrei: (() => { const st = getComputedStyle(range);
                    const top = rr.top - parseFloat(st.outlineOffset || 0) - parseFloat(st.outlineWidth || 0);
                    return nr.bottom <= top + 0.5 && wr.bottom <= top + 0.5; })(),
                  ausschnitt: (() => { const st = getComputedStyle(range), sc = r(sr.querySelector('.scrubber'));
                    const ring = parseFloat(st.outlineOffset || 0) + parseFloat(st.outlineWidth || 0);
                    const left = Math.min(sc.left, rr.left - ring), top = Math.min(sc.top, nr.top, wr.top, rr.top - ring);
                    const right = Math.max(sc.right, rr.right + ring), bottom = Math.max(sc.bottom, rr.bottom + ring);
                    return { x: Math.max(0, left - 4), y: Math.max(0, top - 4),
                             width: right - left + 8, height: bottom - top + 8 }; })(),
                  // Unscrolled and inside the viewport: viewport and page coordinates of the clip agree.
                  ausschnittImFenster: scrollX === 0 && scrollY === 0
                    && rr.bottom + 8 <= innerHeight && nr.top >= 4,
                };
            }""")

        schieber = {"vorher": schieber_messen()}
        page.locator("localtrack-timeline-card .scrubber input[type=range]").focus()
        page.keyboard.press("ArrowRight")
        page.keyboard.press("ArrowRight")
        page.wait_for_timeout(200)
        schieber["nach_pfeil"] = schieber_messen()
        # Clip around caption, slider and its focus ring (plus 4 px), not the bare
        # .scrubber box: that cut the caption at the top edge and the ring on three sides.
        page.screenshot(path=str(OUT / "timeline-scrubber.png"),
                        clip=schieber["nach_pfeil"]["ausschnitt"])
        schieber["bild"] = "timeline-scrubber.png"
        page.keyboard.press("Home")
        page.wait_for_timeout(200)
        heute = page.evaluate("() => window.__card._dateEl.value")
        # Erst vor (morgen), dann zurueck: ein abgeschlossener Tag landete im
        # Cache und naehme der Variante stale-loading ihren haengenden Abruf.
        page.locator("localtrack-timeline-card .day-next").click()
        page.wait_for_timeout(600)
        schieber["tag_vor"] = page.evaluate("() => window.__card._dateEl.value")
        page.locator("localtrack-timeline-card .day-prev").click()
        page.wait_for_timeout(600)
        schieber["tag_zurueck"] = page.evaluate("() => window.__card._dateEl.value")
        schieber["heute"] = heute
        page.wait_for_function(
            "window.__card.shadowRoot.querySelectorAll('.segment').length > 0", timeout=20000)

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

        # ── Kartenkopf (M61): Titel bei 480 px hell und dunkel gleich ──────
        # BuschUI.header level 1: --ha-card-header-font-size (im Harness nicht
        # gesetzt, Rueckfall 24 px), Gewicht medium (500), Primaertextfarbe.
        def kopf(p):
            thema = p.evaluate("() => document.documentElement.dataset.theme")
            werte = p.evaluate("""(tag) => {
            const t = document.querySelector(tag).shadowRoot.querySelector('.title');
            const cs = getComputedStyle(t);
            return { groesse: cs.fontSize, gewicht: cs.fontWeight, farbe: cs.color,
                     textfarbe: getComputedStyle(document.documentElement).getPropertyValue('--primary-text-color').trim(),
                     stufe: t.getAttribute('data-level'), rolle: t.getAttribute('role') };
        }""", "localtrack-timeline-card")
            werte["bild"] = "timeline-480-%s.png" % thema
            p.locator("localtrack-timeline-card").screenshot(path=str(OUT / werte["bild"]))
            return werte

        kartenkopf = lauf_breiten(page, breiten=(480,), messung=kopf, vor_messung=voll_breit)

        # ── Regel 1 im Fehlerzustand ───────────────────────────────────────
        # Im Normallauf steht die Lade- und Fehlerbox auf display:none und
        # bliebe damit ungemessen — ausgerechnet sie traegt aber den laengsten
        # Text der Karte. Also einmal mit dem laengsten Text messen, in beiden
        # Themen und bei allen drei Breiten.
        def fehlerzustand(p):
            voll_breit(p)
            p.evaluate("""() => {
                const c = window.__card;
                c._showStatus('error', c._t.nicht_eingerichtet);
            }""")

        regel1_fehlerzustand = lauf_breiten(
            page,
            messung=lambda p: messe_text(p, "localtrack-timeline-card"),
            vor_messung=fehlerzustand,
        )
        page.evaluate("() => window.__card._showStatus(null)")

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

        # ── Variante „stale-loading" (#1304, M51) ──────────────────────────
        # Tageswechsel mit haengender Antwort: der heutige Tag bleibt gedimmt
        # und aria-busy stehen (Liste, Zeitregler, Weg), der Ladehinweis
        # liegt durchscheinend ueber der Karte. Gestern ist ein abgeschlossener
        # Tag, aber noch nie gesehen, kommt also nicht aus dem Cache. Danach
        # zurueck auf heute. Je Thema ein Bild, dazu Regel 1 in diesem Zustand.
        def stale_bild(p):
            thema = p.evaluate("() => document.documentElement.dataset.theme")
            vorher = p.evaluate("""() => {
                const sr = window.__card.shadowRoot;
                return { zeilen: sr.querySelectorAll('.segment').length,
                         listeOben: Math.round(sr.querySelector('.segments').getBoundingClientRect().top) };
            }""")
            p.evaluate("""() => {
                const c = window.__card;
                window.__hangHistory = true;
                window.__heute = c._dateEl.value;
                const d = new Date(); d.setDate(d.getDate() - (window.__staleSchritt = (window.__staleSchritt || 0) + 1));
                const pad = (n) => String(n).padStart(2, '0');
                c._dateEl.value = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
                c._dateEl.dispatchEvent(new Event('change'));
            }""")
            p.wait_for_timeout(300)
            werte = p.evaluate("""() => {
                const sr = window.__card.shadowRoot;
                const liste = sr.querySelector('.segments');
                const ueber = sr.querySelector('.map-overlay');
                return {
                  zeilen: sr.querySelectorAll('.segment').length,
                  listeOben: Math.round(liste.getBoundingClientRect().top),
                  ariaBusyListe: liste.getAttribute('aria-busy'),
                  ariaBusyKarte: sr.querySelector('.map-wrap').getAttribute('aria-busy'),
                  deckkraftListe: Number(getComputedStyle(liste).opacity),
                  // M27: the state block carries icon and title; the title is the hint.
                  hinweis: (ueber.querySelector('.busch-state-title') || ueber).textContent.trim(),
                  rolle: ueber.getAttribute('role'), live: ueber.getAttribute('aria-live'),
                  hinweisSichtbar: getComputedStyle(ueber).display !== 'none',
                  hinweisDurchscheinend: getComputedStyle(ueber).backgroundColor,
                  wegDa: sr.querySelectorAll('.leaflet-overlay-pane path').length > 0,
                };
            }""")
            werte["vorher"] = vorher
            werte["regel1"] = messe_text(p, "localtrack-timeline-card")
            name = "timeline-320-%s-stale-loading.png" % thema
            p.locator("localtrack-timeline-card").screenshot(path=str(OUT / name))
            werte["bild"] = name
            p.evaluate("""async () => {
                const c = window.__card;
                window.__hangHistory = false;
                for (const go of window.__heldHistory.splice(0)) go();
                await new Promise((r) => setTimeout(r, 100));
                c._dateEl.value = window.__heute;
                c._dateEl.dispatchEvent(new Event('change'));
            }""")
            p.wait_for_timeout(800)
            werte["nachher"] = p.evaluate("""() => {
                const sr = window.__card.shadowRoot;
                return { ariaBusy: sr.querySelector('.segments').getAttribute('aria-busy'),
                         hinweis: sr.querySelector('.map-overlay').textContent.trim() };
            }""")
            return werte

        stale = lauf_breiten(page, breiten=(320,), messung=stale_bild, vor_messung=voll_breit)

        # ── Variante „mapcard" (#1304, M21) ────────────────────────────────
        # Je Reihenfolge eine frische Seite: einmal baut die Timeline zuerst
        # ihre Karte, einmal busch-map-card. Seitenfehler zaehlen je Seite.
        mapcard = {"busch_bundle": str(BUSCH_JS), "busch_bundle_da": BUSCH_JS.exists(), "laeufe": []}
        if BUSCH_JS.exists():
            for zuerst, datei in (("localtrack", "mapcard-localtrack.html"),
                                  ("busch", "mapcard-busch.html")):
                mp = browser.new_page(viewport={"width": 620, "height": 900}, locale="de-DE")
                fehler = []
                mp.on("pageerror", lambda e, f=fehler: f.append(str(e)))
                mp.goto(f"http://127.0.0.1:{PORT}/{datei}", wait_until="load")
                mp.wait_for_function("typeof window.__lauf === 'function'", timeout=20000)
                lauf = mp.evaluate("(z) => window.__lauf(z)", zuerst)
                mp.wait_for_timeout(1500)   # Kacheln laden lassen
                name = "mapcard-%s-zuerst.png" % zuerst
                mp.screenshot(path=str(OUT / name), full_page=True)
                lauf.update({"seitenfehler": fehler, "bild": name})
                mapcard["laeufe"].append(lauf)
                mp.close()

        # ── Variante „picker-preview" (#1304, M53) ─────────────────────────
        # Eigene Seite mit eigenem Anfrageprotokoll: Kacheln oder Nominatim
        # waeren hier echte Netzanfragen und muessen fehlen.
        picker = {"anfragen": [], "seitenfehler": []}
        pp = browser.new_page(viewport={"width": 720, "height": 1100}, locale="de-DE")
        pp.on("request", lambda r: picker["anfragen"].append(r.url))
        pp.on("pageerror", lambda e: picker["seitenfehler"].append(str(e)))
        pp.goto(f"http://127.0.0.1:{PORT}/picker-preview.html", wait_until="load")
        pp.wait_for_function("window.__pickerFertig === true", timeout=20000)
        pp.wait_for_timeout(2500)   # Zeit fuer etwaige Abrufe, die es nicht geben darf
        picker.update(pp.evaluate("""() => {
            const [tl, zt] = window.__karten;
            return {
              karten: window.__karten.map((k) => k.tagName.toLowerCase()),
              vorschau: window.__karten.map((k) => k._preview === true),
              wsCalls: window.__wsCalls,
              windowL: !!window.L,
              timelineZeilen: tl.shadowRoot.querySelectorAll('.segment').length,
              timelineWeg: !!tl.shadowRoot.querySelector('.map svg.preview-route'),
              timelineLeaflet: !!tl.shadowRoot.querySelector('.leaflet-container'),
              zonenZeilen: zt.shadowRoot.querySelectorAll('tbody tr').length,
              zonenTabelleSichtbar: !zt.shadowRoot.querySelector('table').hidden,
              titel: window.__karten.map((k) => k.shadowRoot.querySelector('.title').textContent),
            };
        }"""))
        pp.screenshot(path=str(OUT / "picker-preview.png"), full_page=True)
        pp.set_viewport_size({"width": 390, "height": 1600})
        pp.wait_for_timeout(400)
        pp.screenshot(path=str(OUT / "picker-preview-390.png"), full_page=True)
        picker["bilder"] = ["picker-preview.png", "picker-preview-390.png"]
        pp.close()
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
    "mapcard": mapcard,
    "picker_preview": picker,
    "stale_loading": stale,
    "schieber": schieber,
    "kartenkopf": kartenkopf,
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
    # mapcard (#1304, M21): Leaflet erst bei Bedarf, eine Instanz fuer beide Karten.
    "mapcard: busch-cards.js gefunden": mapcard["busch_bundle_da"],
    "mapcard: zwei Reihenfolgen gelaufen": len(mapcard["laeufe"]) == 2,
    # picker-preview (#1304, M53, E11): statische Vorschau ohne Abrufe.
    "picker-preview: beide Karten im Waehler": picker.get("karten") ==
        ["localtrack-timeline-card", "localtrack-zone-time-card"],
    "picker-preview: beide Karten in der statischen Vorschau": picker.get("vorschau") == [True, True],
    "picker-preview: kein WebSocket-Aufruf": picker.get("wsCalls") == [],
    "picker-preview: keine Kachel- oder Nominatim-Anfrage": not any(
        "tile" in u or "nominatim" in u for u in picker["anfragen"]),
    "picker-preview: nur Seite und Buendel angefragt": all(
        u.startswith(f"http://127.0.0.1:{PORT}/") for u in picker["anfragen"]),
    "picker-preview: Leaflet nicht ausgewertet": picker.get("windowL") is False,
    "picker-preview: Timeline zeigt Beispielweg ohne Leaflet":
        picker.get("timelineWeg") is True and picker.get("timelineLeaflet") is False,
    "picker-preview: Timeline zeigt Beispieltag": picker.get("timelineZeilen", 0) >= 3,
    "picker-preview: Zonenzeit zeigt Beispielmonat":
        picker.get("zonenTabelleSichtbar") is True and picker.get("zonenZeilen", 0) >= 28,
    "picker-preview: keine Seitenfehler": picker["seitenfehler"] == [],
}
# Zeitregler und Tageswahl (M56): gestaltet, beschriftet, im Bild, per Taste bedienbar.
_sv, _sn = schieber["vorher"], schieber["nach_pfeil"]
checks.update({
    "Schieber: gestaltet (appearance none)": _sv["appearance"] == "none",
    "Schieber: Daumen und Schiene aus --primary-color": _sv["daumenPrimaer"] and _sv["schienePrimaer"],
    "Schieber: Trefferflaeche mindestens 44 px hoch": _sv["hoehe"] >= 44,
    "Schieber: ganz im Bild der Karte": _sv["imBild"],
    "Schieber: sichtbare Beschriftung ueber dem Schieber": _sv["beschriftung"] == "Uhrzeit"
        and _sv["beschriftungSichtbar"] and _sv["beschriftungUeberSchieber"] and _sv["beschriftungFuer"],
    "Schieber: aria-label gleich der Beschriftung": _sv["ariaLabel"] == _sv["beschriftung"],
    "Schieber: aria-valuetext gleich dem sichtbaren Wert": _sv["valuetext"] == _sv["wert"] != "",
    "Schieber: Pfeiltaste schiebt weiter": _sn["value"] == _sv["value"] + 2,
    "Schieber: Fokusrahmen kreuzt die Beschriftung nicht": _sn["fokussiert"] and _sn["ringFrei"],
    "Schieber: Bildausschnitt umfasst Beschriftung und Fokusrahmen": _sn["ausschnittImFenster"],
    "Schieber: aria-valuetext folgt der Pfeiltaste": _sn["valuetext"] == _sn["wert"]
        and _sn["valuetext"] != _sv["valuetext"],
    "Tageswahl: Beschriftung Tag am Datumsfeld": _sv["tagBeschriftung"] == "Tag" and _sv["tagFuer"],
    "Tageswahl: Datumsfeld mit lang aus hass.locale": _sv["datumLang"] == "de",
    "Tageswahl: Vor/Zurueck benannt, type button, 44 px": all(
        k["name"] and k["typ"] == "button" and k["breite"] >= 44 and k["hoehe"] >= 44
        for k in (_sv["zurueck"], _sv["vor"])),
    "Tageswahl: Vor und Zurueck wechseln den Tag": schieber["tag_vor"] > schieber["heute"]
        and schieber["tag_zurueck"] == schieber["heute"],
})
# Kartenkopf (M61): Stufe 1, 24 px, medium, Primaertext, in beiden Themen gleich.
_kopf = [l["messung"] for l in kartenkopf["laeufe"]]
checks.update({
    "Kartenkopf: zwei Laeufe bei 480 px (hell, dunkel)": len(_kopf) == 2,
    "Kartenkopf: Titel Stufe 1 als Ueberschrift": all(m["stufe"] == "1" and m["rolle"] == "heading" for m in _kopf),
    "Kartenkopf: 24 px, Gewicht 500, in beiden Themen gleich": all(
        m["groesse"] == "24px" and m["gewicht"] == "500" for m in _kopf),
})
# stale-loading (#1304, M51): alter Tag bleibt gedimmt und aria-busy stehen.
_stale = [l["messung"] for l in stale["laeufe"]]
checks.update({
    "stale-loading: zwei Bilder (hell, dunkel)": len(_stale) == 2,
    "stale-loading: alte Liste bleibt stehen": all(
        m["zeilen"] == m["vorher"]["zeilen"] and m["zeilen"] > 0 and m["wegDa"] for m in _stale),
    "stale-loading: kein Layoutsprung": all(
        m["listeOben"] == m["vorher"]["listeOben"] for m in _stale),
    "stale-loading: aria-busy an Liste und Karte, gedimmt": all(
        m["ariaBusyListe"] == "true" and m["ariaBusyKarte"] == "true" and m["deckkraftListe"] < 1
        for m in _stale),
    "stale-loading: Ladehinweis sichtbar": all(
        m["hinweisSichtbar"] and m["hinweis"] == "Lade …" for m in _stale),
    "stale-loading: Ladehinweis als Live-Region (M27)": all(
        m["rolle"] == "status" and m["live"] == "polite" for m in _stale),
    "stale-loading: Regel 1 ohne Befund": all(
        len(m["regel1"][k]) == 0 for m in _stale for k in ("ueberlauf", "ausserhalb", "ueberlappung")),
    "stale-loading: nach der Antwort nicht mehr busy": all(
        m["nachher"]["ariaBusy"] == "false" and m["nachher"]["hinweis"] == "" for m in _stale),
})
for _lauf in mapcard["laeufe"]:
    _z = _lauf["zuerst"]
    checks.update({
        f"mapcard ({_z} zuerst): Laden beider Buendel wertet kein Leaflet aus":
            _lauf["nachLaden"] == {"windowL": False, "leafletGlobal": False},
        f"mapcard ({_z} zuerst): beide Karten fertig": _lauf["erste"] and _lauf["zweite"],
        f"mapcard ({_z} zuerst): Leaflet 1.9.4": _lauf["version"] == "1.9.4",
        f"mapcard ({_z} zuerst): window.L nach der zweiten Karte unveraendert":
            _lauf["windowLUnveraendert"],
        f"mapcard ({_z} zuerst): Timeline nutzt window.L": _lauf["timelineNutztWindowL"],
        f"mapcard ({_z} zuerst): Kachelebene der busch-map-card aus derselben Instanz":
            _lauf["ebeneAusDerselbenInstanz"],
        f"mapcard ({_z} zuerst): keine Seitenfehler": _lauf["seitenfehler"] == [],
    })
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
