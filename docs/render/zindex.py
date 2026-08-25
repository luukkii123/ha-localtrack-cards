#!/usr/bin/env python3
"""Beweist, dass die Timeline-Karte nicht mehr über Dialogen liegt.

Aufruf:  python3 zindex.py <pfad/localtrack-cards.js> <ausgabeordner>

Der Nutzer meldete am 25.08.2026: „die karte liegt über popups". Ursache ist
kein Fehler von Leaflet, sondern eine fehlende Zeile in der Karte: `:host` hatte
nur `display: block` und damit **keinen eigenen Stapelkontext**. Leaflet malt
seine Bedienelemente auf `z-index: 1000` und seine Ebenen auf 400–700; ohne
Stapelkontext am Host konkurrieren diese Zahlen im Wurzelkontext der Seite und
schlagen jede Dialogschicht von Home Assistant.

Das Skript stellt beide Fassungen gegeneinander:

* `vorher`  — `:host { display: block; }` (Stand v0.1.1)
* `nachher` — `:host { display: block; position: relative; z-index: 0; }`

Gemessen wird mit `document.elementFromPoint()` an Punkten, die **innerhalb**
eines nachgebauten Dialogs liegen und zugleich über der Karte. Was dort oben
liegt, entscheidet der Browser — nicht ein Blick auf ein Bild.

Die Datei wird über einen HTTP-Server ausgeliefert und mit `page.goto()`
geladen. Das ist Pflicht, nicht Geschmack: `page.set_content()` setzt das
Dokument auf `about:blank`, und ein Modul von `http://` wird dort still nicht
geladen (siehe hacs/CLAUDE.md).

Auf diesem Server läuft Playwright nur im Container:

    docker run --rm -v "$PWD:/repo" \
      --entrypoint bash mcr.microsoft.com/playwright/python:v1.62.0-noble \
      -c 'pip install --quiet --break-system-packages playwright==1.62.0 >/dev/null; \
          python3 /repo/docs/render/zindex.py /repo/dist/localtrack-cards.js \
                  /repo/docs/render/zindex-ergebnis'
"""
import json
import pathlib
import subprocess
import sys
import time

from playwright.sync_api import sync_playwright

JS = pathlib.Path(sys.argv[1])
OUT = pathlib.Path(sys.argv[2])
OUT.mkdir(parents=True, exist_ok=True)
SERVE = OUT / "serve"
SERVE.mkdir(exist_ok=True)
PORT = 8098

FIXED = ":host { display: block; position: relative; z-index: 0; }"
PLAIN = ":host { display: block; }"

source = JS.read_text(encoding="utf-8")
if FIXED not in source:
    sys.exit(f"Erwartete Regel nicht gefunden: {FIXED!r} — Karte schon geändert?")

# „nachher" ist die ausgelieferte Datei selbst, „vorher" dieselbe Datei mit der
# einen zurückgedrehten Zeile. Damit misst der Lauf genau diese Änderung und
# nichts sonst.
(SERVE / "nachher.js").write_text(source, encoding="utf-8")
(SERVE / "vorher.js").write_text(source.replace(FIXED, PLAIN, 1), encoding="utf-8")

PAGE = """<!doctype html>
<meta charset="utf-8">
<title>localtrack z-index</title>
<style>
  :root {
    --primary-color: #03a9f4; --accent-color: #ff9800;
    --primary-text-color: #212121; --secondary-text-color: #727272;
    --divider-color: #e0e0e0; --card-background-color: #fff;
    --ha-card-background: #fff; --secondary-background-color: #e5e5e5;
  }
  body { margin: 0; padding: 16px; background: #f2f4f7; font-family: Roboto, sans-serif; }
  #wrap { max-width: 560px; margin: 0 auto; }
  ha-card { display: block; background: #fff; border-radius: 12px; padding: 16px; }

  /* Nachbau der Dialogschicht von Home Assistant. `mwc-dialog` — worauf
     ha-dialog und der Mehr-Info-Dialog aufsetzen — legt seinen Vordergrund auf
     z-index 7. Genau diese Zahl wird hier benutzt, damit der Vergleich etwas
     über die echte Oberfläche aussagt und nicht über eine erfundene. */
  #scrim  { position: fixed; inset: 0; background: rgba(0,0,0,.32); z-index: 7; display: none; }
  /* Deckt den ganzen Kartenbereich ab. Ein kleinerer Dialog würde die Messung
     verfälschen: die Sonden müssen zwingend über den Leaflet-Ebenen landen,
     nicht über gewöhnlichem Karteninhalt, der ohnehin im Fluss gemalt wird. */
  #dialog { position: fixed; left: 8px; top: 8px; width: 604px; height: 780px;
            background: #fff; border-radius: 16px;
            box-shadow: 0 8px 32px rgba(0,0,0,.35); z-index: 7; display: none;
            padding: 20px; box-sizing: border-box; }
  body.dialog-open #scrim, body.dialog-open #dialog { display: block; }
</style>
<div id="wrap"></div>
<div id="scrim"></div>
<div id="dialog"><h2>Mehr-Info</h2><p>Dieser Dialog muss oben liegen.</p></div>
<script>
  class HaCard extends HTMLElement {}
  customElements.define('ha-card', HaCard);
  class HaIcon extends HTMLElement {
    connectedCallback() { this.style.cssText = 'display:inline-block;width:24px;height:24px'; }
  }
  customElements.define('ha-icon', HaIcon);
  class HaForm extends HTMLElement {}
  customElements.define('ha-form', HaForm);

  const day = new Date(); day.setHours(0, 0, 0, 0);
  const at = (h, m) => Math.round((day.getTime() + (h * 60 + m) * 60000) / 1000);
  const HOME = [52.5163, 13.3777];
  const points = [];
  for (let i = 0; i <= 20; i++)
    points.push({ ts: at(8, i * 5), lat: HOME[0] + i * 0.0004, lon: HOME[1] + i * 0.0006 });

  window.__hass = {
    locale: { language: 'de' },
    states: { 'person.test': { entity_id: 'person.test', state: 'home',
      last_updated: new Date().toISOString(),
      attributes: { friendly_name: 'Testperson', latitude: HOME[0], longitude: HOME[1] } } },
    callWS(msg) {
      if (msg.type === 'localtrack/history') return Promise.resolve({ points });
      return Promise.reject({ code: 'unknown_command' });
    },
    callService() { return Promise.resolve(); },
  };
</script>
<script src="/__VARIANT__.js"></script>
<script>
  window.__ready = (async () => {
    const card = document.createElement('localtrack-timeline-card');
    /* Bewusst OHNE `title` — so muss die Karte den freundlichen Namen der
       Entität nehmen (`Testperson`) statt `person.test`. */
    card.setConfig({ type: 'custom:localtrack-timeline-card', entity: 'person.test',
                     height: 320, show_scrubber: true });
    document.getElementById('wrap').appendChild(card);
    card.hass = window.__hass;
    window.__card = card;
    return true;
  })();
</script>
"""

server = subprocess.Popen(
    [sys.executable, "-m", "http.server", str(PORT), "--directory", str(SERVE)],
    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
)
time.sleep(1.5)

PROBE = """() => {
    document.body.classList.add('dialog-open');
    const dialog = document.getElementById('dialog');
    const card = window.__card;
    const sr = card.shadowRoot;
    const box = dialog.getBoundingClientRect();

    // Der Treffer ist oft ein Kind (etwa das <p> im Dialog). Interessant ist,
    // WEM es gehoert — also der naechste Vorfahre mit einer id.
    const name = (el) => {
      if (!el) return null;
      for (let node = el; node; node = node.parentElement) {
        if (node.id) return '#' + node.id;
      }
      return el.tagName.toLowerCase();
    };
    // Gemessen wird ausschliesslich ueber Leaflet-Elementen — das sind die mit
    // hohem z-index. Gewoehnlicher Karteninhalt liegt im normalen Fluss und
    // wuerde ohnehin unter dem Dialog bleiben; ihn zu sondieren beweist nichts.
    // Konkret gerenderte Elemente, keine Ebenen-Container: `.leaflet-tile-pane`
    // & Co. haben ein leeres Kastenmass, eine Sonde darauf meldet nur
    // „unsichtbar" und beweist nichts.
    const targets = {
      kachel: sr.querySelector('img.leaflet-tile'),                 // Ebene z-index 200
      route: sr.querySelector('.leaflet-overlay-pane svg'),         // Ebene z-index 400
      pin: sr.querySelector('.leaflet-marker-icon'),                // Ebene z-index 600
      zoomKnopf: sr.querySelector('.leaflet-control-zoom'),         // Bedienung z-index 800/1000
      quellenhinweis: sr.querySelector('.leaflet-control-attribution'),
    };

    const probes = {};
    const abgedeckt = {};
    for (const [key, el] of Object.entries(targets)) {
      if (!el) { probes[key] = 'fehlt'; continue; }
      let rect = el.getBoundingClientRect();
      // Die Ebenen sind riesig und ragen ueber den Kartenausschnitt hinaus.
      // Auf den sichtbaren Ausschnitt beschneiden, sonst zeigt die Sonde
      // irgendwohin neben die Karte.
      const view = sr.querySelector('.leaflet-container').getBoundingClientRect();
      const left = Math.max(rect.left, view.left), right = Math.min(rect.right, view.right);
      const top = Math.max(rect.top, view.top), bottom = Math.min(rect.bottom, view.bottom);
      if (right <= left || bottom <= top) { probes[key] = 'unsichtbar'; continue; }
      // `elementFromPoint` ist eine TREFFER-Abfrage, keine Mal-Abfrage: ein
      // Element mit `pointer-events: none` wird uebersprungen, der Zeiger faellt
      // hindurch. Leaflet setzt das auf Kacheln, Marker und SVG-Pfade. Solche
      // Sonden duerfen nicht als Urteil zaehlen — im ersten Lauf meldete die
      // Kachel in BEIDEN Fassungen den Dialog und sah nach einem Widerspruch
      // aus, obwohl sie schlicht nichts gemessen hat.
      if (getComputedStyle(el).pointerEvents === 'none') {
        probes[key] = 'nicht-hittestbar';
        continue;
      }
      const x = (left + right) / 2, y = (top + bottom) / 2;
      const imDialog = x > box.left && x < box.right && y > box.top && y < box.bottom;
      abgedeckt[key] = imDialog;
      probes[key] = imDialog ? name(document.elementFromPoint(x, y)) : 'ausserhalb';
    }
    return {
      overlaps: Object.values(abgedeckt).some(Boolean),
      abgedeckt,
      hostZIndex: getComputedStyle(card).zIndex,
      hostPosition: getComputedStyle(card).position,
      titel: sr.querySelector('.title').textContent,
      probes,
    };
}"""

results = {}
console_errors, page_errors = [], []
with sync_playwright() as pw:
    browser = pw.chromium.launch(args=["--no-sandbox"])
    for variant in ("vorher", "nachher"):
        (SERVE / f"page-{variant}.html").write_text(
            PAGE.replace("__VARIANT__", variant), encoding="utf-8"
        )
        page = browser.new_page(viewport={"width": 620, "height": 900}, locale="de-DE")
        page.on("console", lambda m: console_errors.append((m.type, m.text)) if m.type == "error" else None)
        page.on("pageerror", lambda e: page_errors.append(str(e)))
        page.goto(f"http://127.0.0.1:{PORT}/page-{variant}.html", wait_until="load")
        page.wait_for_function("window.__card && window.__card._map", timeout=20000)
        page.wait_for_timeout(2500)
        results[variant] = page.evaluate(PROBE)
        page.wait_for_timeout(300)
        page.screenshot(path=str(OUT / f"{variant}.png"))
        page.close()
    browser.close()
server.terminate()

# Urteil: vorher muss die Karte gewinnen, nachher der Dialog. Beides zusammen
# belegt, dass genau die geaenderte Zeile den Unterschied macht.
#
# `fehlt` / `unsichtbar` / `ausserhalb` sind KEINE Urteile, sondern Sonden, die
# gar nicht messen konnten. Sie mitzuzaehlen hat den ersten Lauf faelschlich
# durchfallen lassen, obwohl die Messung selbst richtig war.
_KEIN_URTEIL = ("fehlt", "unsichtbar", "ausserhalb", "nicht-hittestbar")


def urteilende_sonden(entry):
    return {k: v for k, v in entry["probes"].items() if v not in _KEIN_URTEIL}


def wins_dialog(entry):
    echte = urteilende_sonden(entry)
    return bool(echte) and all(value in ("#dialog", "#scrim") for value in echte.values())

verdict = {
    "ueberlappung_vorhanden": results["vorher"]["overlaps"] and results["nachher"]["overlaps"],
    "sonden_die_gemessen_haben": {
        variant: sorted(urteilende_sonden(entry)) for variant, entry in results.items()
    },
    "vorher_karte_liegt_oben": not wins_dialog(results["vorher"]),
    "nachher_dialog_liegt_oben": wins_dialog(results["nachher"]),
    # Zweiter Wunsch aus demselben Durchlauf: der Titel zeigt den freundlichen
    # Namen. Die Prüfseite setzt bewusst kein `title:`.
    "titel_ist_freundlicher_name": results["nachher"]["titel"] == "Testperson",
    "titel_gemessen": results["nachher"]["titel"],
    "console_errors": console_errors,
    "page_errors": page_errors,
}
verdict["bestanden"] = (
    verdict["ueberlappung_vorhanden"]
    and verdict["vorher_karte_liegt_oben"]
    and verdict["nachher_dialog_liegt_oben"]
    and verdict["titel_ist_freundlicher_name"]
    and not console_errors
    and not page_errors
)

report = {"messung": results, "urteil": verdict}
(OUT / "report.json").write_text(
    json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8"
)
print(json.dumps(report, indent=2, ensure_ascii=False))
sys.exit(0 if verdict["bestanden"] else 1)
