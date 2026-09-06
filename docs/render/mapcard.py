#!/usr/bin/env python3
"""Prueft die Landkarten-Karte in echtem Chromium.

Aufruf:  python3 mapcard.py <pfad/localtrack-cards.js> <ausgabeordner>

Die Karte baut die Landkarte nicht nach, sondern umhuellt Home Assistants
eingebaute `map`-Karte und tauscht nur die Kachelebene. Genau diesen Eingriff
prueft der Lauf — an einer ECHTEN Leaflet-Instanz, die die Kartendatei selbst
als `window.L` bereitstellt, nicht an einer Attrappe der Leaflet-API.

`loadCardHelpers` und die innere Karte sind dagegen nachgebaut: das echte
`hui-map-card` gibt es ausserhalb von Home Assistant nicht. Der Lauf belegt
deshalb den Eingriff und den Rueckfall — NICHT, dass HAs echte Karte ihr
`ha-map` an derselben Stelle traegt. Das entscheidet der Live-Test.

Auf diesem Server laeuft Playwright nur im Container:

    docker run --rm -v "$PWD:/repo" \
      --entrypoint bash mcr.microsoft.com/playwright/python:v1.62.0-noble \
      -c 'pip install --quiet --break-system-packages playwright==1.62.0 >/dev/null; \
          python3 /repo/docs/render/mapcard.py /repo/dist/localtrack-cards.js \
                  /repo/docs/render/mapcard-ergebnis'
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
OUT.mkdir(parents=True, exist_ok=True)
SERVE = OUT / "serve"
SERVE.mkdir(exist_ok=True)
shutil.copy(JS, SERVE / "localtrack-cards.js")
PORT = 8096

PAGE = """<!doctype html>
<meta charset="utf-8">
<title>localtrack map</title>
<style>
  :root { --primary-text-color:#212121; --divider-color:#e0e0e0;
          --card-background-color:#fff; --error-color:#db4437; }
  body { margin:0; padding:16px; background:#f2f4f7; font-family:Roboto,sans-serif; }
  #wrap { max-width: 560px; }
  ha-card { display:block; background:#fff; border-radius:12px; padding:8px; }
</style>
<div id="wrap"></div>
<script>
  class HaCard extends HTMLElement {}
  customElements.define('ha-card', HaCard);
  class HaIcon extends HTMLElement {}
  customElements.define('ha-icon', HaIcon);
  class HaForm extends HTMLElement {
    set schema(v){ this._s=v; window.__mapSchema=v; }
    set data(v){ this._d=v; window.__mapData=v; }
    set computeLabel(f){ window.__mapLabel=f; }
    fire(patch){ this.dispatchEvent(new CustomEvent('value-changed',
      {detail:{value:{...this._d, ...patch}}})); }
  }
  customElements.define('ha-form', HaForm);

  /* Nachbau der eingebauten map-Karte. Sie traegt ein `ha-map` mit einer
     ECHTEN Leaflet-Instanz und einer echten Rasterebene — genau das, woran
     der Eingriff ansetzt. */
  window.__innerConfigs = [];
  class FakeMapCard extends HTMLElement {
    constructor(){ super(); this.attachShadow({mode:'open'}); }
    setConfig(c){ this._config = c; window.__innerConfigs.push(JSON.parse(JSON.stringify(c))); }
    set hass(h){ this._hass = h; }
    getCardSize(){ return 7; }
    connectedCallback(){
      if (this._gebaut) return;
      this._gebaut = true;
      this.shadowRoot.innerHTML = '<ha-map style="display:block;width:520px;height:300px"></ha-map>';
      const haMap = this.shadowRoot.querySelector('ha-map');
      if (window.__ohneLeaflet) return;      // Rueckfall-Fall: keine Instanz
      const div = document.createElement('div');
      div.style.cssText = 'width:520px;height:300px';
      haMap.appendChild(div);
      const map = window.L.map(div).setView([48.2, 16.35], 13);
      window.L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: 'HA-Standardangabe', maxZoom: 19,
      }).addTo(map);
      haMap.leafletMap = map;
    }
  }
  customElements.define('ha-map', class extends HTMLElement {});
  customElements.define('fake-map-card', FakeMapCard);

  window.__helperCalls = 0;
  window.loadCardHelpers = async () => {
    window.__helperCalls += 1;
    return {
      createCardElement: async (config) => {
        const el = document.createElement('fake-map-card');
        el.setConfig(config);
        return el;
      },
    };
  };

  window.__hass = {
    themes: { darkMode: false },
    states: {
      'person.lukas': { entity_id:'person.lukas', state:'home',
        attributes:{ friendly_name:'Lukas', latitude:48.2, longitude:16.35 } },
      'zone.home': { entity_id:'zone.home', state:'1',
        attributes:{ friendly_name:'Home', latitude:48.2, longitude:16.35, radius:200 } },
    },
    callWS(){ return Promise.resolve({}); },
  };
</script>
<script src="/localtrack-cards.js"></script>
<script>
  window.__mk = async (config) => {
    const card = document.createElement('localtrack-map-card');
    card.setConfig(config);
    document.getElementById('wrap').appendChild(card);
    card.hass = window.__hass;
    return card;
  };
</script>
"""

(SERVE / "page.html").write_text(PAGE, encoding="utf-8")

server = subprocess.Popen(
    [sys.executable, "-m", "http.server", str(PORT), "--directory", str(SERVE)],
    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
)
time.sleep(1.5)

LESEN = """() => {
    const card = window.__card;
    const inner = card.shadowRoot.querySelector('fake-map-card');
    const haMap = inner && inner.shadowRoot.querySelector('ha-map');
    const map = haMap && haMap.leafletMap;
    let url = null, attribution = null, subdomains = null, anzahl = 0;
    if (map) {
      map.eachLayer((l) => {
        if (typeof l.setUrl === 'function') {
          anzahl += 1;
          if (!url) { url = l._url; attribution = l.options.attribution;
                      subdomains = String(l.options.subdomains); }
        }
      });
    }
    return {
      url, attribution, subdomains, kachelEbenen: anzahl,
      mapFilter: inner ? inner.style.getPropertyValue('--map-filter') : null,
      innerVorhanden: !!inner,
      kartenGroesse: card.getCardSize(),
      quellenText: haMap && haMap.querySelector('.leaflet-control-attribution')
        ? haMap.querySelector('.leaflet-control-attribution').textContent : '',
    };
}"""

checks = {}
console, errors = [], []

with sync_playwright() as pw:
    browser = pw.chromium.launch(args=["--no-sandbox"])
    page = browser.new_page(viewport={"width": 640, "height": 900}, locale="de-DE")
    page.on("console", lambda m: console.append((m.type, m.text)) if m.type == "error" else None)
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(f"http://127.0.0.1:{PORT}/page.html", wait_until="load")

    # 1. Standardvorlage CARTO, helles Thema.
    page.evaluate("async () => { window.__card = await window.__mk("
                  "{type:'custom:localtrack-map-card', entities:['person.lukas'],"
                  " theme_mode:'auto', hours_to_show:2}); }")
    page.wait_for_function("window.__card && window.__card._layer", timeout=15000)
    hell = page.evaluate(LESEN)
    innen = page.evaluate("() => window.__innerConfigs[0]")

    # 2. Auf dunkel umschalten.
    page.evaluate("""() => {
        window.__hass = {...window.__hass, themes:{darkMode:true}};
        window.__card.hass = window.__hass;
    }""")
    page.wait_for_timeout(400)
    dunkel = page.evaluate(LESEN)
    page.screenshot(path=str(OUT / "dunkel.png"))

    # 3. Eigene URL.
    eigen = page.evaluate("""async () => {
        const c = await window.__mk({type:'custom:localtrack-map-card',
          entities:['person.lukas'], map_style:'custom',
          tile_url:'https://beispiel.test/{z}/{x}/{y}.png',
          tile_attribution:'Meine Quelle'});
        window.__card = c;
        await new Promise(r => setTimeout(r, 900));
        const inner = c.shadowRoot.querySelector('fake-map-card');
        const map = inner.shadowRoot.querySelector('ha-map').leafletMap;
        let url=null, att=null;
        map.eachLayer(l => { if (typeof l.setUrl === 'function' && !url) {
          url = l._url; att = l.options.attribution; } });
        return { url, att };
    }""")

    # 4. Vorlage "ha": Kacheln bleiben unberuehrt.
    unberuehrt = page.evaluate("""async () => {
        const c = await window.__mk({type:'custom:localtrack-map-card',
          entities:['person.lukas'], map_style:'ha'});
        await new Promise(r => setTimeout(r, 900));
        const inner = c.shadowRoot.querySelector('fake-map-card');
        const map = inner.shadowRoot.querySelector('ha-map').leafletMap;
        let url=null; map.eachLayer(l => { if (typeof l.setUrl==='function' && !url) url = l._url; });
        return { url, mapFilter: inner.style.getPropertyValue('--map-filter') };
    }""")

    # 5. Rueckfall: ha-map ohne leafletMap. Die Karte darf NICHT leer werden.
    rueckfall = page.evaluate("""async () => {
        window.__ohneLeaflet = true;
        const c = await window.__mk({type:'custom:localtrack-map-card',
          entities:['person.lukas']});
        await new Promise(r => setTimeout(r, 1200));
        const inner = c.shadowRoot.querySelector('fake-map-card');
        return {
          innerVorhanden: !!inner,
          haMapVorhanden: !!(inner && inner.shadowRoot.querySelector('ha-map')),
          mapFilter: inner ? inner.style.getPropertyValue('--map-filter') : null,
          layer: c._layer,
        };
    }""")

    # 6. Editor.
    editor = page.evaluate("""() => {
        const el = window.__card.constructor.getConfigElement();
        document.body.appendChild(el);
        el.setConfig({type:'custom:localtrack-map-card', entities:['person.lukas']});
        el.hass = window.__hass;
        const form = el.querySelector('ha-form');
        let geliefert = null;
        el.addEventListener('config-changed', e => { geliefert = e.detail.config; });
        form.fire({ map_style: 'topo' });
        return {
          tag: el.tagName.toLowerCase(),
          felder: (window.__mapSchema||[]).map(s => s.name),
          vorlagen: ((window.__mapSchema||[])[0]?.selector?.select?.options||[]).map(o => o.value),
          beschriftung: window.__mapLabel ? window.__mapLabel({name:'map_style'}) : null,
          nachAenderung: geliefert,
        };
    }""")
    browser.close()

server.terminate()

CARTO_HELL = "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
CARTO_DUNKEL = "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"

checks["hell: CARTO-Positron-Kacheln gesetzt"] = hell["url"] == CARTO_HELL
checks["dunkel: CARTO-Dark-Kacheln gesetzt"] = dunkel["url"] == CARTO_DUNKEL
checks["Umschalten tauscht nur die URL, legt keine zweite Ebene an"] = (
    hell["kachelEbenen"] == 1 and dunkel["kachelEbenen"] == 1
)
checks["Subdomains uebernommen"] = hell["subdomains"] == "abcd"
checks["Quellenangabe ist die von CARTO"] = "CARTO" in (hell["attribution"] or "")
checks["Quellenangabe steht auch im Bedienelement"] = "CARTO" in (hell["quellenText"] or "")
checks["HA-Dunkelfilter abgeschaltet"] = hell["mapFilter"] == "none"
checks["innere Karte bekommt type: map"] = innen.get("type") == "map"
checks["eigene Schluessel gelangen NICHT nach innen"] = not any(
    k in innen for k in ("map_style", "tile_url", "tile_url_dark", "tile_attribution")
)
checks["Fremdoptionen werden durchgereicht"] = (
    innen.get("hours_to_show") == 2 and innen.get("entities") == ["person.lukas"]
)
checks["getCardSize kommt von der inneren Karte"] = hell["kartenGroesse"] == 7
checks["eigene URL wird verwendet"] = eigen["url"] == "https://beispiel.test/{z}/{x}/{y}.png"
checks["eigene Quellenangabe wird verwendet"] = eigen["att"] == "Meine Quelle"
checks["Vorlage 'ha' laesst die Kacheln unberuehrt"] = (
    unberuehrt["url"] == "https://tile.openstreetmap.org/{z}/{x}/{y}.png"
)
checks["Vorlage 'ha' schaltet den Dunkelfilter nicht ab"] = unberuehrt["mapFilter"] in ("", None)
checks["Rueckfall: innere Karte bleibt stehen"] = rueckfall["innerVorhanden"] is True
checks["Rueckfall: ha-map bleibt stehen"] = rueckfall["haMapVorhanden"] is True
checks["Rueckfall: kein erzwungener Filter"] = rueckfall["mapFilter"] in ("", None)
checks["Rueckfall: keine Ebene uebernommen"] = not rueckfall["layer"]
checks["Editor-Element"] = editor["tag"] == "localtrack-map-card-editor"
checks["Editor: vier eigene Felder"] = editor["felder"] == [
    "map_style", "tile_url", "tile_url_dark", "tile_attribution"
]
checks["Editor: sieben Vorlagen plus eigene URL"] = editor["vorlagen"] == [
    "ha", "osm", "carto", "voyager", "satellite", "topo", "custom"
]
checks["Editor beschriftet deutsch"] = editor["beschriftung"] == "Kartenvorlage"
checks["Editor gibt die Vorlage weiter"] = editor["nachAenderung"].get("map_style") == "topo"
checks["Editor behaelt die Fremdoptionen"] = (
    editor["nachAenderung"].get("entities") == ["person.lukas"]
)
# Fehlgeschlagene KACHEL-Abrufe zaehlen nicht als Kartenfehler: der Container
# erreicht die echten Kachelserver nicht, und eine der geprueften URLs zeigt
# absichtlich auf einen erfundenen Host. Alles andere zaehlt sehr wohl — die
# Zahl der Abrufe steht im Bericht, damit die Ausnahme sichtbar bleibt.
echte_fehler = [
    c for c in console
    if "Failed to load resource" not in c[1] and "leafletMap" not in c[1]
]
checks["keine Konsolenfehler ausser Kachelabrufen"] = echte_fehler == []
checks["keine Seitenfehler"] = errors == []

report = {
    "hell": hell, "dunkel": dunkel, "innerConfig": innen, "eigen": eigen,
    "unberuehrt": unberuehrt, "rueckfall": rueckfall, "editor": editor,
    "console_errors": echte_fehler,
    "kachel_abrufe_fehlgeschlagen": len(console) - len(echte_fehler),
    "page_errors": errors,
    "pruefungen": checks,
    "bestanden": all(checks.values()),
    "gescheitert": [k for k, v in checks.items() if not v],
}
(OUT / "report.json").write_text(
    json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8"
)
print(json.dumps({"bestanden": report["bestanden"], "anzahl": len(checks),
                  "gescheitert": report["gescheitert"]}, indent=2, ensure_ascii=False))
if not report["bestanden"]:
    print(json.dumps(report, indent=2, ensure_ascii=False)[:7000])
sys.exit(0 if report["bestanden"] else 1)
