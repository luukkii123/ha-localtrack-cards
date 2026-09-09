#!/usr/bin/env python3
"""Prueft die Verweildauer-Karte in echtem Chromium.

Aufruf:  python3 zonetime.py <pfad/localtrack-cards.js> <ausgabeordner>

Geprueft wird gegen den TATSAECHLICH gerenderten Text, nicht gegen einen Blick
aufs Bild: Zeileninhalte, Fussrechnung, Menueinhalte, der Aufrufzaehler des
WebSocket-Befehls, der Stapelkontext am `:host` und der Wegfall der
Bruttospalte auf schmalem Ansichtsfenster. Dazu der Editor.

Die Datei wird ueber einen eigenen HTTP-Server ausgeliefert und mit
`page.goto()` geladen. Das ist Pflicht, nicht Geschmack: `page.set_content()`
setzt das Dokument auf `about:blank`, und ein Modul von `http://` wird dort
still nicht geladen (siehe hacs/CLAUDE.md).

Seit 09.09.2026 misst derselbe Lauf zusaetzlich `docs/ui-regeln.md`, Regel 1
und 4, ueber `regeln.py`: `lauf_breiten` + `messe_text` bei 320, 480 und 960 px
in hellem und dunklem Thema, davor `selbsttest` als Falsifikation der Messung.

Auf diesem Server laeuft Playwright nur im Container. Der Aufruf braucht
**beide** Mounts, `/work` (hacs/docs/render, wegen `regeln.py`) und `/cards`:

    docker run --rm \
      -v "/mnt/user/Data/Claude Projekte/hacs/docs/render:/work" \
      -v "/mnt/user/Data/Claude Projekte/hacs/ha-localtrack-cards:/cards" \
      --entrypoint bash mcr.microsoft.com/playwright/python:v1.62.0-noble \
      -c 'pip install --quiet --break-system-packages playwright==1.62.0 >/dev/null; \
          python3 /cards/docs/render/zonetime.py /cards/dist/localtrack-cards.js \
                  /cards/docs/render/zonetime-ergebnis'
"""
import json
import pathlib
import shutil
import subprocess
import sys
import time

from playwright.sync_api import sync_playwright

# `/work` ist der Mount von hacs/docs/render im Container; der zweite Pfad
# findet dasselbe Modul ausserhalb des Containers.
for _kandidat in ("/work",
                  str(pathlib.Path(__file__).resolve().parents[3] / "docs" / "render")):
    if _kandidat not in sys.path:
        sys.path.append(_kandidat)
from regeln import bewerte, lauf_breiten, messe_text, selbsttest, zaehle

JS = pathlib.Path(sys.argv[1])
OUT = pathlib.Path(sys.argv[2])
OUT.mkdir(parents=True, exist_ok=True)
SERVE = OUT / "serve"
SERVE.mkdir(exist_ok=True)
shutil.copy(JS, SERVE / "localtrack-cards.js")
PORT = 8097

PAGE = """<!doctype html>
<meta charset="utf-8">
<title>localtrack zone-time</title>
<style>
  :root {
    --primary-color: #03a9f4; --accent-color: #ff9800;
    --primary-text-color: #212121; --secondary-text-color: #727272;
    --disabled-text-color: #bdbdbd; --divider-color: #e0e0e0;
    --card-background-color: #fff; --ha-card-background: #fff;
    --secondary-background-color: #e5e5e5;
  }
  body { margin: 0; padding: 16px; background: #f2f4f7; font-family: Roboto, sans-serif;
         color: var(--primary-text-color); }
  #wrap { max-width: __MAXW__px; margin: 0 auto; }
</style>
<div id="wrap"></div>
<script>
  /* ha-card MUSS einen eigenen Shadow-Root mit :host-Stil mitbringen: die
     Karte rendert ihre ha-card INNERHALB ihres eigenen Shadow-Roots, und
     Dokument-CSS erreicht sie dort nicht — die Regel `ha-card { display:block }`
     im <style> oben blieb wirkungslos, die ha-card war `display: inline`.
     Fuer messe_text ist das nicht kosmetisch: die ha-card ist das
     Bezugsrechteck von Regel 1, Pruefung 2. */
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
  class HaIcon extends HTMLElement {}
  customElements.define('ha-icon', HaIcon);

  /* Attrappe fuer ha-form. Sie haelt genau den Vertrag ein, auf den der
     Editor sich stuetzt: hass/schema/data/computeLabel hinein, ein
     `value-changed` mit dem GANZEN Datenobjekt heraus. Damit ist die
     Verdrahtung belegt — NICHT, dass Home Assistants echtes ha-form diese
     Selektoren so darstellt. Das entscheidet erst der Live-Test. */
  class HaForm extends HTMLElement {
    set schema(v) { this._schema = v; window.__formSchema = v; }
    get schema() { return this._schema; }
    set data(v) { this._data = v; window.__formData = v; }
    get data() { return this._data; }
    set computeLabel(fn) { this._label = fn; window.__formLabel = fn; }
    set computeHelper(fn) { this._helper = fn; window.__formHelper = fn; }
    fire(patch) {
      this.dispatchEvent(new CustomEvent('value-changed', {
        detail: { value: { ...this._data, ...patch } },
      }));
    }
  }
  customElements.define('ha-form', HaForm);

  /* ── erfundener hass ───────────────────────────────────────────────────── */
  window.__ws = [];
  const ZONE_TIME_ANSWER = {
    entity_id: 'person.lukas',
    days: [
      { date: '2026-09-01', net_s: 29520, gross_s: 29520, visits: 1 },
      { date: '2026-09-02', net_s: 28080, gross_s: 29940, visits: 2 },
      { date: '2026-09-03', net_s: 31860, gross_s: 35760, visits: 1 },
    ],
    total_net_s: 89460, total_gross_s: 95220, total_visits: 4, days_present: 3,
  };
  window.__hass = {
    locale: { language: 'de' },
    states: {
      'person.lukas': { entity_id: 'person.lukas', state: 'not_home',
        attributes: { friendly_name: 'Lukas' } },
      'person.diana': { entity_id: 'person.diana', state: 'home',
        attributes: { friendly_name: 'Diana' } },
      'person.ignoriert': { entity_id: 'person.ignoriert', state: 'home',
        attributes: { friendly_name: 'Nicht aufgezeichnet' } },
      'zone.lukas_arbeit': { entity_id: 'zone.lukas_arbeit', state: '0',
        attributes: { friendly_name: 'Lukas Arbeit', latitude: 48.2016,
                      longitude: 16.3566, radius: 138 } },
      'zone.home': { entity_id: 'zone.home', state: '2',
        attributes: { friendly_name: 'Home', latitude: 48.275,
                      longitude: 16.374, radius: 213 } },
      'zone.stix': { entity_id: 'zone.stix', state: '0',
        attributes: { friendly_name: 'Stix', latitude: 48.27,
                      longitude: 16.38, radius: 19 } },
      /* Ohne Koordinaten: darf NICHT im Menue erscheinen. */
      'zone.kaputt': { entity_id: 'zone.kaputt', state: '0',
        attributes: { friendly_name: 'Ohne Koordinaten' } },
    },
    callWS(msg) {
      window.__ws.push(msg);
      if (msg.type === 'localtrack/stats') {
        return Promise.resolve({ tracked: ['person.lukas', 'person.diana'] });
      }
      if (msg.type === 'localtrack/zone_time') return Promise.resolve(ZONE_TIME_ANSWER);
      return Promise.reject({ code: 'unknown_command', message: 'Unknown command.' });
    },
    callService() { return Promise.resolve(); },
  };
</script>
<script src="/localtrack-cards.js"></script>
<script>
  window.__ready = (async () => {
    const card = document.createElement('localtrack-zone-time-card');
    /* Bewusst ohne title:, ohne min_visit_minutes, ohne max_gap_minutes —
       die Standardwerte muessen greifen. */
    card.setConfig({ type: 'custom:localtrack-zone-time-card',
                     entity: 'person.lukas', zone: 'zone.lukas_arbeit' });
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

console, errors = [], []
checks = {}


def probe_script(month_clicks: int) -> str:
    return """(clicks) => {
        const card = window.__card;
        const sr = card.shadowRoot;
        for (let i = 0; i < clicks; i++) sr.querySelector('.next').click();
        return true;
    }"""


WIDE = """() => {
    const card = window.__card;
    const sr = card.shadowRoot;
    const rows = [...sr.querySelectorAll('tbody tr')];
    const text = (tr) => [...tr.querySelectorAll('td')]
        .map((td) => td.textContent.replace(/\\s+/g, ' ').trim());
    const foot = [...sr.querySelectorAll('tfoot tr')].map(text);
    const style = getComputedStyle(card);
    const opts = (sel) => [...sr.querySelectorAll(sel + ' option')]
        .map((o) => o.value);
    return {
      zeilen: rows.length,
      erste: text(rows[0]),
      zweite: text(rows[1]),
      dritte: text(rows[2]),
      vierte: text(rows[3]),
      letzte: text(rows[rows.length - 1]),
      fuss: foot,
      notiz: sr.querySelector('.note').textContent.trim(),
      monatstitel: sr.querySelector('.month .label').textContent.trim(),
      titel: sr.querySelector('.title').textContent.trim(),
      hostPosition: style.position,
      hostZIndex: style.zIndex,
      personen: opts('.pick-entity'),
      zonen: opts('.pick-zone'),
      bruttoSichtbar: sr.querySelector('th.gross').getBoundingClientRect().width > 0,
      balkenSichtbar: sr.querySelector('td.bar').getBoundingClientRect().width > 0,
      status: sr.querySelector('.status').hidden,
      wsTypen: window.__ws.map((m) => m.type),
      wsZoneTime: window.__ws.filter((m) => m.type === 'localtrack/zone_time'),
    };
}"""

with sync_playwright() as pw:
    browser = pw.chromium.launch(args=["--no-sandbox"])

    # ── breit ──────────────────────────────────────────────────────────────
    (SERVE / "page.html").write_text(PAGE.replace("__MAXW__", "560"), encoding="utf-8")
    page = browser.new_page(viewport={"width": 620, "height": 1400}, locale="de-DE")
    page.on("console", lambda m: console.append((m.type, m.text)) if m.type == "error" else None)
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(f"http://127.0.0.1:{PORT}/page.html", wait_until="load")
    page.wait_for_function("window.__card && window.__card._result", timeout=20000)
    page.wait_for_timeout(400)
    wide = page.evaluate(WIDE)

    # Monatswechsel: genau EIN weiterer Aufruf.
    vorher = len(wide["wsZoneTime"])
    page.evaluate("() => window.__card.shadowRoot.querySelector('.next').click()")
    page.wait_for_timeout(600)
    nach = page.evaluate("() => window.__ws.filter(m => m.type === 'localtrack/zone_time').length")
    titel_neu = page.evaluate("() => window.__card.shadowRoot.querySelector('.month .label').textContent.trim()")

    # Editor.
    editor = page.evaluate("""() => {
        const el = window.__card.constructor.getConfigElement();
        document.body.appendChild(el);
        el.setConfig({ type: 'custom:localtrack-zone-time-card',
                       entity: 'person.lukas', zone: 'zone.lukas_arbeit' });
        el.hass = window.__hass;
        const form = el.querySelector('ha-form');
        const out = {
          tag: el.tagName.toLowerCase(),
          felder: (window.__formSchema || []).map((s) => s.name),
          beschriftungen: (window.__formSchema || []).map((s) => window.__formLabel(s)),
          /* Regel 3: jedes Feld braucht auch einen Helper. Gemessen wird der
             tatsaechlich gelieferte Text, nicht die Existenz der Funktion. */
          hilfetexte: (window.__formSchema || []).map((s) => window.__formHelper(s)),
          daten: window.__formData,
        };
        let geliefert = null;
        el.addEventListener('config-changed', (e) => { geliefert = e.detail.config; });
        /* 5 ist der Standard und muss weggestrichen werden, 45 weicht ab
           und muss stehen bleiben. Waehle NIE den aktuellen Standardwert
           als Abweichung — der Test wird dann still nichtssagend. */
        form.fire({ min_visit_minutes: 5, max_gap_minutes: 45 });
        out.nachAenderung = geliefert;
        return out;
    }""")

    # Zweiter Editor mit englischer Locale: Regel 3 verlangt beide Sprachen,
    # und „es gibt ein Woerterbuch" ist kein Beleg dafuer, dass die Karte auch
    # danach greift. Gemessen wird der ausgelieferte Text, nicht die Absicht.
    editor_en = page.evaluate("""() => {
        const el = window.__card.constructor.getConfigElement();
        document.body.appendChild(el);
        el.setConfig({ type: 'custom:localtrack-zone-time-card',
                       entity: 'person.lukas', zone: 'zone.lukas_arbeit' });
        el.hass = { ...window.__hass, locale: { language: 'en' } };
        return {
          beschriftungen: (window.__formSchema || []).map((s) => window.__formLabel(s)),
          hilfetexte: (window.__formSchema || []).map((s) => window.__formHelper(s)),
        };
    }""")
    # Regel 3 gilt auch fuer das DATUM in der Tagesspalte. Ein Woerterbuch
    # liefert nur den Wochentag; die Zahlen kommen aus Intl und muessen
    # `hass.locale.language` folgen. Gemessen an einer zweiten Karte, weil der
    # hass-Setter bewusst nicht neu rendert (siehe dist, set hass).
    tag_sprachen = page.evaluate("""async () => {
        const lies = async (sprache) => {
          const c = document.createElement('localtrack-zone-time-card');
          c.setConfig({ type: 'custom:localtrack-zone-time-card',
                        entity: 'person.lukas', zone: 'zone.lukas_arbeit' });
          document.body.appendChild(c);
          c.hass = { ...window.__hass, locale: { language: sprache } };
          for (let i = 0; i < 100; i++) {
            const tr = c.shadowRoot.querySelector('tbody tr');
            if (tr && tr.querySelector('td.day').textContent.trim()) break;
            await new Promise((r) => setTimeout(r, 50));
          }
          const wert = c.shadowRoot.querySelector('tbody tr td.day')
              .textContent.replace(/\\s+/g, ' ').trim();
          c.remove();
          return wert;
        };
        return { de: await lies('de'), en: await lies('en') };
    }""")

    page.screenshot(path=str(OUT / "breit.png"), full_page=True)

    # ── Regel 1 und 4: 320/480/960 px, hell und dunkel ─────────────────────
    def voll_breit(p):
        """Karte auf die volle Ansichtsfensterbreite bringen. Der Editor aus
        der Messung davor haengt noch am body und wuerde sonst mitscrollen."""
        p.evaluate("""() => {
            document.body.style.padding = '0';
            const wrap = document.getElementById('wrap');
            wrap.style.maxWidth = 'none';
            wrap.style.width = '100%';
            for (const el of document.querySelectorAll('localtrack-zone-time-card-editor'))
              el.remove();
        }""")

    # ── table-layout: fixed beweisen, nicht behaupten ──────────────────────
    # `gekuerzt: 0` unten belegt nur, dass nichts zu lang WAR — nicht, dass
    # eine zu lange Zelle gekuerzt WUERDE. Ohne table-layout: fixed richtet
    # sich die Spalte nach dem laengsten Inhalt, die Tabelle waechst, und
    # `text-overflow` bekommt nie eine Kante. Also: eine Zelle absichtlich
    # ueberfuellen und messen, ob Spalte und Tabelle ihre Breite behalten.
    page.set_viewport_size({"width": 320, "height": 1400})
    voll_breit(page)
    page.wait_for_timeout(400)
    zelle = page.evaluate("""() => {
        const sr = window.__card.shadowRoot;
        const tab = sr.querySelector('table');
        const td = sr.querySelector('tbody td.day');
        const alt = td.textContent;
        const vorher = { tabelle: tab.getBoundingClientRect().width,
                         zelle: td.getBoundingClientRect().width };
        td.textContent = 'Donnerstag der siebenundzwanzigste September zweitausendsechsundzwanzig';
        const st = getComputedStyle(td);
        const out = {
          tableLayout: getComputedStyle(tab).tableLayout,
          textOverflow: st.textOverflow,
          overflowX: st.overflowX,
          vorher,
          nachher: { tabelle: tab.getBoundingClientRect().width,
                     zelle: td.getBoundingClientRect().width },
          scrollWidth: td.scrollWidth,
          clientWidth: td.clientWidth,
        };
        td.textContent = alt;
        return out;
    }""")
    page.wait_for_timeout(200)

    page.set_viewport_size({"width": 480, "height": 1400})
    voll_breit(page)
    page.wait_for_timeout(400)
    regel1_selbsttest = selbsttest(page, "localtrack-zone-time-card")
    regel1 = lauf_breiten(
        page,
        messung=lambda p: messe_text(p, "localtrack-zone-time-card"),
        vor_messung=voll_breit,
        hoehe=1600,
    )

    # ── Regel 4: je ein Bild pro Thema bei 320 px ──────────────────────────
    # Zahlen belegen Lage und Groesse, nicht Lesbarkeit. Schrift in
    # Hintergrundfarbe faellt in keiner Messung auf.
    bilder = []

    def bild(p):
        thema = p.evaluate("() => document.documentElement.dataset.theme")
        name = "zonetime-320-%s.png" % thema
        p.locator("localtrack-zone-time-card").screenshot(path=str(OUT / name))
        bilder.append(name)
        return {"bild": name}

    lauf_breiten(page, breiten=(320,), messung=bild, vor_messung=voll_breit, hoehe=1600)
    page.close()

    # ── schmal ─────────────────────────────────────────────────────────────
    (SERVE / "page-schmal.html").write_text(PAGE.replace("__MAXW__", "330"), encoding="utf-8")
    page = browser.new_page(viewport={"width": 360, "height": 1400}, locale="de-DE")
    page.on("console", lambda m: console.append((m.type, m.text)) if m.type == "error" else None)
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(f"http://127.0.0.1:{PORT}/page-schmal.html", wait_until="load")
    page.wait_for_function("window.__card && window.__card._result", timeout=20000)
    page.wait_for_timeout(400)
    narrow = page.evaluate(WIDE)
    page.screenshot(path=str(OUT / "schmal.png"), full_page=True)
    page.close()
    browser.close()

server.terminate()

# ── Urteil ────────────────────────────────────────────────────────────────
checks["30 Zeilen fuer September"] = wide["zeilen"] == 30
checks["Tag 1: 8:12 netto und brutto"] = wide["erste"][1:3] == ["8:12", "8:12"]
checks["Tag 2: brutto groesser netto"] = wide["zweite"][1:3] == ["7:48", "8:19"]
checks["Tag 3: 8:51 / 9:56"] = wide["dritte"][1:3] == ["8:51", "9:56"]
checks["leerer Tag zeigt Gedankenstrich"] = wide["vierte"][1:3] == ["—", "—"]
checks["Wochentag steht vor dem Datum"] = wide["erste"][0].startswith("Di")
# de: "Di 01.09."  en: "Tu 09/01" — Wochentag aus dem Woerterbuch, Zahlen aus
# Intl. Das Sollwertpaar faengt beides: eine feste Sprache und ein Datum, das
# gar nicht mehr erscheint.
checks["Tagesspalte deutsch: 01.09."] = (
    tag_sprachen["de"].startswith("Di") and "01.09." in tag_sprachen["de"]
)
checks["Tagesspalte englisch: 09/01"] = (
    tag_sprachen["en"].startswith("Tu") and "09/01" in tag_sprachen["en"]
)
checks["Tagesspalte unterscheidet die Sprachen"] = (
    tag_sprachen["de"] != tag_sprachen["en"]
)
checks["Summe = 24:51 / 26:27"] = wide["fuss"][0][1:3] == ["24:51", "26:27"]
checks["Schnitt = 8:17"] = wide["fuss"][1][1] == "8:17"
checks["Notiz nennt 3 von 30 Tagen"] = "3 von 30" in wide["notiz"]
checks["Titel = friendly_name der Zone"] = wide["titel"] == "Lukas Arbeit"
checks["Host hat Stapelkontext"] = (
    wide["hostPosition"] == "relative" and wide["hostZIndex"] == "0"
)
checks["Personen kommen aus stats.tracked"] = wide["personen"] == [
    "person.lukas", "person.diana"
]
checks["Zone ohne Koordinaten fehlt im Menue"] = "zone.kaputt" not in wide["zonen"]
checks["Zonen alphabetisch"] = wide["zonen"] == ["zone.home", "zone.lukas_arbeit", "zone.stix"]
checks["genau ein zone_time-Aufruf beim Start"] = vorher == 1
checks["Monatswechsel loest genau einen weiteren aus"] = nach == 2
checks["Monatstitel wechselt auf Oktober"] = titel_neu == "Oktober 2026"
checks["Standardwerte greifen ohne Konfiguration"] = (
    wide["wsZoneTime"][0]["min_visit_s"] == 300
    and wide["wsZoneTime"][0]["max_gap_s"] == 1800
)
checks["Zonenkoordinaten werden mitgeschickt"] = (
    wide["wsZoneTime"][0]["radius"] == 138
    and abs(wide["wsZoneTime"][0]["latitude"] - 48.2016) < 1e-9
)
checks["Monatsgrenzen ohne Zeitzonenanhang"] = (
    wide["wsZoneTime"][0]["start"] == "2026-09-01T00:00:00"
    and wide["wsZoneTime"][0]["end"] == "2026-09-30T23:59:59"
)
checks["Status ausgeblendet nach dem Laden"] = wide["status"] is True
checks["breit: Bruttospalte sichtbar"] = wide["bruttoSichtbar"] is True
checks["breit: Balken sichtbar"] = wide["balkenSichtbar"] is True
checks["schmal: Balken weg"] = narrow["balkenSichtbar"] is False
checks["schmal: Zeilen bleiben vollstaendig"] = narrow["zeilen"] == 30
checks["schmal: Nettozahl bleibt"] = narrow["erste"][1] == "8:12"
checks["Editor-Element"] = editor["tag"] == "localtrack-zone-time-card-editor"
checks["Editor hat sechs Felder"] = editor["felder"] == [
    "entity", "zone", "title", "min_visit_minutes", "max_gap_minutes", "show_gross"
]
# Der Selektor laesst person.* UND device_tracker.* zu — das Label sagt das in
# beiden Sprachen, seit dem 09.09.2026 auch auf Deutsch ("Person" war zu eng).
checks["Editor beschriftet deutsch"] = editor["beschriftungen"][0] == "Person oder Gerät"
checks["Editor zeigt Standardwerte"] = (
    editor["daten"]["min_visit_minutes"] == 5 and editor["daten"]["show_gross"] is True
)
checks["Editor schreibt Standardwerte NICHT"] = (
    "min_visit_minutes" not in editor["nachAenderung"]
)
checks["Editor schreibt Abweichungen schon"] = (
    editor["nachAenderung"].get("max_gap_minutes") == 45
)
checks["keine Konsolenfehler"] = console == []
checks["keine Seitenfehler"] = errors == []

# ── Regel 3: Editor mit Label UND Helper, in beiden Sprachen ───────────────
checks["Editor liefert zu jedem Feld einen Helper"] = (
    len(editor["hilfetexte"]) == len(editor["felder"])
    and all(bool(h) and h.strip().endswith(".") for h in editor["hilfetexte"])
)
checks["Editor beschriftet englisch bei englischer Locale"] = (
    editor_en["beschriftungen"][0] == "Person or device"
)
checks["Editor hilft englisch bei englischer Locale"] = (
    editor_en["hilfetexte"][0].startswith("The person or device")
)

# ── Regel 1 und 4 ─────────────────────────────────────────────────────────
zahlen = zaehle(regel1)
checks["Selbsttest: Ueberlauf wird erkannt"] = regel1_selbsttest["ueberlauf_erkannt"]
checks["Selbsttest: ausserhalb wird erkannt"] = regel1_selbsttest["ausserhalb_erkannt"]
checks["Selbsttest: gewollte Kuerzung gilt nicht als Ueberlauf"] = (
    regel1_selbsttest["ellipsis_nicht_gemeldet"]
)
checks["Regel 1: kein Ueberlauf"] = zahlen["ueberlauf"] == 0
checks["Regel 1: nichts ausserhalb der Karte"] = zahlen["ausserhalb"] == 0
checks["Regel 1: keine Ueberlappung"] = zahlen["ueberlappung"] == 0
checks["Regel 1: sechs Laeufe (3 Breiten x 2 Themen)"] = len(regel1["laeufe"]) == 6
checks["Tabelle hat table-layout: fixed"] = zelle["tableLayout"] == "fixed"
checks["Zelle kuerzt mit ellipsis"] = zelle["textOverflow"].startswith("ellipsis")
checks["ueberlange Zelle waechst nicht"] = (
    abs(zelle["nachher"]["zelle"] - zelle["vorher"]["zelle"]) < 1
)
checks["ueberlange Zelle sprengt die Tabelle nicht"] = (
    abs(zelle["nachher"]["tabelle"] - zelle["vorher"]["tabelle"]) < 1
)
checks["ueberlanger Text wird wirklich abgeschnitten"] = (
    zelle["scrollWidth"] > zelle["clientWidth"]
)
checks["Regel 1: in jedem Lauf wurde etwas gemessen"] = all(
    l["messung"].get("geprueft", 0) > 0 for l in regel1["laeufe"]
)

report = {
    "breit": wide,
    "schmal": {k: narrow[k] for k in ("zeilen", "erste", "bruttoSichtbar", "balkenSichtbar")},
    "editor": editor,
    "editor_en": editor_en,
    "tag_sprachen": tag_sprachen,
    "regel1": regel1,
    "regel1_tabellenzelle": zelle,
    "regel1_selbsttest": regel1_selbsttest,
    "regel1_zaehlung": zahlen,
    "regel4_bilder": bilder,
    "console_errors": console,
    "page_errors": errors,
    "pruefungen": checks,
    "bestanden": all(checks.values()),
    "gescheitert": [k for k, v in checks.items() if not v],
}
report["bestanden"] = report["bestanden"] and bewerte(report) == 0
(OUT / "report.json").write_text(
    json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8"
)
print(json.dumps({"bestanden": report["bestanden"],
                  "gescheitert": report["gescheitert"],
                  "anzahl": len(checks)}, indent=2, ensure_ascii=False))
if not report["bestanden"]:
    print(json.dumps(report, indent=2, ensure_ascii=False)[:6000])
sys.exit(0 if report["bestanden"] else 1)
