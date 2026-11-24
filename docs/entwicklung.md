# Entwicklung

Hinweise für alle, die an den Karten mitarbeiten. Nutzer brauchen sie nicht.

## Kein Build-Schritt

`dist/localtrack-cards.js` ist Quelltext und Auslieferung in einem: Vanilla-JS
mit Custom Elements, kein Bundler. Eine HACS-Dashboard-Ressource liefert genau
eine Datei aus, Unterordner erreichen den Browser nie. Deshalb steckt
**Leaflet 1.9.4** (BSD-2-Clause) vollständig in der Datei: die UMD-Fassung, das
CSS als injizierter `<style>`, die vier Marker-PNGs als `data:`-URIs (Abschnitt
`BEGIN VENDOR` bis `END VENDOR`). Nachgeladen werden nur Kartenkacheln. Das
erklärt die Dateigröße von rund 270 kB. Ausgewertet wird die UMD erst beim
ersten Kartenaufbau (`localtrackLeaflet()`, #1304); liegt schon ein Leaflet auf
der Seite (busch-cards), nutzen beide Karten diese eine Instanz.

Zwei Vendor-Blöcke mit Hash im Marker (`/* BEGIN VENDOR <name> 1.9.4 sha256:… */` …
`/* END VENDOR <name> */`, Hash über die Bytes zwischen den Markern, geprüft am 18.11.2026):
`leaflet` ist `leaflet.js` von `unpkg.com/leaflet@1.9.4/dist/`, nur ohne Sourcemap-Zeile
(Hash `dc71f8a6…`, gleich wie in `ha-busch-cards`); `leaflet-css` enthält `leaflet.css` und die
PNGs als JS-Literale (CRLF → LF, `url(images/…)` → `data:`-URIs). Der CI-Schritt „Vendor blocks
match their hash“ prüft beide Hashes; `tests/vendor.test.js` macht die zwei CSS-Änderungen
rückgängig und vergleicht mit dem Upstream-Hash von `leaflet.css`. Leaflet-Updates laufen in
beiden Repos gleichzeitig.

Auch die gemeinsame UI-Basis (Editorbasis, Config-/Event-/Tastaturhelfer,
Header- und Statusprimitives) steckt direkt in der Datei. Ein gemeinsames Paket
über mehrere Repos würde einen Build-Schritt oder eine zusätzliche
Laufzeitdatei verlangen.

Vor jedem Tag muss `CARD_VERSION` in der Datei zum Tag passen; der
Release-Workflow prüft das.

## Darstellungstests

Unter `docs/render/` liegen Playwright-Skripte, die die ausgelieferte Datei in
Chromium rendern. `ha-card`, `ha-icon` und `ha-form` sind Attrappen, die
WebSocket-Antworten (`localtrack/history`, `localtrack/stats`,
`localtrack/zone_time`) sind erfunden. Der Editor wird gegen eine
`ha-form`-Attrappe geprüft; ob Home Assistants echtes `ha-form` die Selektoren
genauso darstellt, entscheidet erst ein Test in einer echten Installation.

| Skript | Prüft |
| --- | --- |
| `render.py` | Timeline-Karte: Textüberlauf, Kollisionen, Hell/Dunkel bei 320/480/960 px, Netzanfragen (Seite, JS, Kacheln; keine Nachladung aus Unterordnern); Variante `mapcard`: mit busch-map-card auf einer Seite, eine Leaflet-Instanz in beiden Ladereihenfolgen; Variante `picker-preview`: beide Karten im nachgebauten Kartenwähler ohne WebSocket-, Kachel- und Nominatim-Abruf; Variante `stale-loading`: Tageswechsel mit hängender Antwort, alter Tag gedimmt mit `aria-busy`; Zeitregler (M56): gestaltet, 44 px, im Bild, beschriftet, Pfeiltasten und `aria-valuetext`, Tageswahl mit Beschriftung, `lang` und Vor/Zurück (Bild `timeline-scrubber.png`); Kartenkopf (M61) bei 480 px hell/dunkel (Bilder `timeline-480-*.png`); Kontrast und Touchziele (M26, Bereiche `kontrast`/`touch`, Ausnahmen mit Grund in `kontrast-ausnahmen.json`) |
| `zonetime.py` | Verweildauer-Karte: dasselbe, dazu Sprachen und Tageszeilen; Variante `stale-loading`: Monatswechsel mit hängender Antwort, alter Monat gedimmt mit `aria-busy`, Hinweis in der Notizzeile; Kartenkopf (M61, Bilder `zonetime-480-*.png`); Kontrast und Touchziele (M26) wie `render.py`; Chromium-Gegenprobe XSS (M1, Bereich `xss`, Bild `zonetime-xss.png`) |
| `zindex.py` | Stapelkontext der Karte gegen Dialogschichten (Leaflet vergibt hohe z-index-Werte; der Host der Karte bildet deshalb einen eigenen Stapelkontext) |
| `editor_contract.py` | beide Editoren: unveränderte Werte lösen kein erneutes Form-Update aus, `0` und `false` bleiben erhalten, verschachtelte Werte sind vom Eingabeobjekt isoliert, `keydown`/`keyup` verlassen den Editor nicht |
| `shared_ui_contract.py` | beide Karten und Editoren: lange Namen, Lade-, Leer-, Fehler- und Datenzustände, 44-px-Aktionsflächen, Tastaturfokus; erzeugt die Bilder unter `docs/visual-baselines/` |

Die Skripte laufen in einem Playwright-Container
(`mcr.microsoft.com/playwright/python:v1.62.0-noble`). Der `docker run`-Aufruf
steht im Kopf des jeweiligen Skripts. Sie benötigen zusätzlich das Messmodul
`regeln.py` aus dem lokalen Verwaltungsordner des Maintainers, das nicht Teil
dieses Repositories ist; ohne es laufen sie nicht.

**Chromium-Gegenprobe XSS (M1).** Die Node-Tests (`tests/zonetime-xss.test.js`)
belegen die Auswahlmenüs in einer DOM-Attrappe. Seit Chromium 135 bleibt ein
`<img onerror>` innerhalb von `<select>` beim Parsen erhalten; ob die Karte
wirklich kein Element erzeugt, zeigt deshalb erst der echte Browser.
`zonetime.py` setzt jede Nutzlast aus `XSS_PAYLOADS` (`tests/_testkit.cjs`,
dieselbe Quelle wie die Node-Tests) als `friendly_name` von Personen und Zonen
und prüft im Shadow-DOM: `querySelectorAll('img').length === 0`, kein
`script`, kein `on*`-Attribut, kein Dialog, und jede Nutzlast steht als Text in
den Menüs, in der Auswahl und im Kartentitel. Ergebnis in `report.json`
(Bereich `xss`, Prüfungen `XSS: …`), Bild `zonetime-xss.png`.

Die Bilder in `docs/visual-baselines/shared-ui-v0.1.0/` sind eine visuelle
Referenz, kein Pixel-Hash-Test: Kacheln von OpenStreetMap können sich ändern.
Sie zeigen ausschließlich synthetische Daten (Route in Berlin, erfundene
Personen und Zonen).

Das Datumsfeld der Timeline zeigt in den Bildern `MM/TT/JJJJ`. Das ist ein
Artefakt des Headless-Chromiums; im Browser des Nutzers steht das Datum in der
eingestellten Sprache. Das Feld trägt `lang` aus `hass.locale`; ob der Browser
das Format danach richtet, entscheidet der Browser (Chromium nimmt meist die
Sprache der Browseroberfläche).

## Technische Hinweise

- **Timeline:** Aufenthalte werden zuerst gegen die Zonen aus Home Assistant
  benannt (kleinste passende Zone gewinnt), sonst „Aufenthalt" oder mit
  `reverse_geocode` der Nominatim-Name. Die Liste wartet nicht auf
  Nominatim: sie steht sofort mit Zonennamen bzw. „Aufenthalt", die Ortsnamen
  werden danach je Zeile in die Beschriftung geschrieben, ohne die Liste neu
  aufzubauen (Fokus und Scroll bleiben). Die Zonen werden einmal je
  `hass.states` vorgefiltert, nicht je Punkt oder Reglerschritt.
  Jede Nominatim-Anfrage hat eine Zeitgrenze von 8 Sekunden
  (`AbortController`); nach einem Fehler oder Abbruch antworten weitere
  Anfragen 60 Sekunden lang ohne Abruf leer (kein Wiederholungssturm), danach
  wird es erneut versucht. Nur Antworten werden zwischengespeichert. Zwei Aufenthalte am selben Ort stapeln
  ihre Nadeln, die Liste zeigt beide. Liegen mehr Punkte vor als `max_points`,
  vereinfacht die Integration sie mit Douglas-Peucker, bevor die Karte sie sieht.
  Steht das Datum auf heute, lädt die Karte nach einer Positionsänderung
  (`latitude`/`longitude`, nicht `last_updated`: ein Akkuwechsel lädt nichts)
  mit rund 30 Sekunden Verzögerung nach, und zwar nur ab dem letzten Punkt
  (`start` = dessen Zeitstempel; die Integration liest `ts >= start`, der
  Grenzpunkt wird über `ts` verworfen). Die Linie wächst mit `addLatLng`, neu
  segmentiert wird nur ab dem letzten offenen Aufenthalt (`segmentTrack`,
  gleiches Ergebnis wie ein voller Lauf). Den ganzen Tag holt sie bei
  Tageswechsel, wenn der letzte Abruf älter als 15 Minuten ist (Lücke) und
  wenn `max_points` erreicht ist (dann dünnt die Integration aus). Ein
  verborgener Tab lädt nicht und holt beim Zurückkehren einmal nach.
  Ausschnitt, Scrubber, Fokus und Scroll bleiben erhalten (kein `fitBounds`,
  kein `panTo` beim Nachladen).
- **Cache und Ladezustand:** Antworten für abgeschlossene Tage und Monate
  (Ende vor jetzt) liegen in einem gemeinsamen LRU-Cache mit höchstens 24
  Einträgen, Schlüssel ist die ganze Abfrage; heute und der laufende Monat
  kommen nie daraus. Lädt ein anderer Tag oder Monat, bleibt der bisherige
  Inhalt gedimmt mit `aria-busy` stehen (Timeline: Hinweis durchscheinend über
  der Karte; Verweildauer: Hinweis in der Notizzeile statt einer Statuszeile
  über der Tabelle). Scheitert der Abruf, verschwindet der alte Inhalt.
- **Verweildauer:** Die Karte rechnet nicht selbst, alle Zahlen kommen aus
  `localtrack/zone_time`. Die Menüs füllen sich aus `localtrack/stats` (Personen)
  und den Zonen von Home Assistant mit Mittelpunkt und Radius. Die Vorbelegung
  im Kartenwähler ist die kleinste Zone außer `zone.home`. Unter 380 px Breite
  entfällt der Balken.
- **Editor:** `getConfigForm` wird bewusst nicht verwendet. Der Editor liefert
  Label und Helper zweisprachig, zeigt die Vorgaben der Verweildauer-Karte nur an
  (beim Speichern landen nur Abweichungen in der Konfiguration) und lässt die
  dynamischen `getStubConfig`-Vorschläge für Person und Zone bestehen.
- **Kartenwähler:** Steckt eine Karte in Home Assistants `hui-card-picker`
  (Vorfahre über Shadow-Grenzen), zeigt sie eine statische Vorschau mit
  Beispieldaten (Beispielweg und -tag, Beispielmonat) und ruft weder
  WebSocket noch Kacheln noch Nominatim ab. Geladen wird erst, wenn die Karte
  in der Seite hängt. Die Vorschau im Bearbeitungsdialog ist eine echte Karte
  und zeigt echte Daten.
- **Netto/brutto:** Ist das Handy lange aus, schreibt netto höchstens
  `max_gap_minutes` gut, brutto zeigt die Spanne trotzdem. Die Companion-App
  meldet nach Bewegung, nicht nach Uhr; ein Tag zu Hause hat daher wenige
  Punkte mit langen Lücken. Zerfällt ein Tag in viele Aufenthalte, ist
  `max_gap_minutes` zu niedrig.
- **Herkunft:** Die Timeline-Karte hieß bis zur Version 0.3.0 von
  [ha-busch-cards](https://github.com/luukkii123/ha-busch-cards)
  `busch-timeline-card`. Wer sie so auf einem Dashboard hat, ändert `type:` auf
  `custom:localtrack-timeline-card`; die Optionen sind unverändert. Die
  Landkarten-Karte `localtrack-map-card` heißt seit dem 06.09.2026
  `busch-map-card` und liegt in ha-busch-cards.

## Geprüft

**20.11.2026 · 0.10.1, Repo-CI (#1325, Tag `v0.10.1`)** — zindex.py ersetzt Kartenkacheln ohne Netz lokal; Vertragsjob `contracts` grün. Karte unverändert. Abschlusslauf `karten-20261120-003418-9d0f74` grün (57/57, Volllauf), `--beleg-pruefen` gleich; Bildabweichungen gegen den Vorlauf nur am Gerätekopf (gewollt) und Rauschen.

**20.11.2026 · 0.10.0, Buschcheck Etappe I (#1325, Tag `v0.10.0`)** — Kopfkommentar mit Test (M73), Regler/Weg/Punkte ≥ 3:1, Fokus-Token, Shared UI 0.5.3, CI aus der Vorlage (M45). 169 Node-Tests. Abschlusslauf `karten-20261119-234243-239269` grün (57/57, Volllauf, 2700 Node-Tests, Block `statisch` grün inkl. CI-Vorlage und Zeilenlänge), `--beleg-pruefen` gleich; Bilder am Bild geprüft (Sonnet).

**19.11.2026 · 0.9.0, Buschcheck Etappe H (#1318, Tag `v0.9.0`)** — Shared UI 0.5.0: Zustandsbaustein mit Live-Region (M27), `.busch-btn` (M62), Tokens und 12-px-Radius-Rückfall (M63), Kopf Stufe 1 (M61), `BuschUI.register` (M42), Kontrast/Touch (M26); Zustände ohne doppelten Rahmen, Ladehinweis als Box oben. M28 entfällt (keine Dialoge). 139 Node-Tests. Abschlusslauf `karten-20261119-195834-aaec84` grün (55/55, 2590 Node-Tests, Block `statisch` grün, Kontrast/Touch gemessen), `--beleg-pruefen` gleich; Bilder zweimal am Bild geprüft (Sonnet), Befunde behoben.

**19.11.2026 · 0.8.0, Buschcheck Etappe G (#1309, Tag `v0.8.0`)** — Zeitleiste benennt ihre Bedienelemente (aria-valuetext, Zeilen-Labels, lang aus hass.locale), eigener beschrifteter Schieber „Uhrzeit“ mit 44-px-Ziel, Tag ‹ › (M56). 110 Node-Tests. Abschlusslauf `karten-20261119-141846-b2547c` grün (43/43, 948 Node-Tests, Block `statisch` grün), `--beleg-pruefen` gleich; Bilder zweimal am Bild geprüft (Sonnet), Mängel bei 320 px behoben, sonst Rauschen.

**19.11.2026 · 0.7.0, Buschcheck Etappe F (#1304, Tag `v0.7.0`)** — Leaflet erst beim ersten Kartenaufbau (M21, Auswertung 10,5 → 0,34 ms), keine Vollschleife je `set hass` (M22, 0,015/0,025 ms, 0 Mutationen), Timeline inkrementell (M35, Live-Abruf ≤ 211 B), Cache für Abgeschlossenes mit gedimmtem Altinhalt (M51, warm 4 ms), Leaflet-Karte beim Aushängen frei (M52), statische Wählervorschau (M53), Liste vor Karte und Ortsnamen nachgereicht (M54, 7119 → 63 ms), Nominatim-Zeitgrenze 8 s (M34-Rest). 100 Node-Tests. Abschlusslauf `karten-20261119-114355-b75c2d` grün (52/52, 1492 Node-Tests, Block `statisch` grün), `--beleg-pruefen` gleich; Bilder gegen den Vorlauf am Bild geprüft (Sonnet), neu `picker-preview*`, `*-stale-loading`, `mapcard-*`, sonst Kacheln/Datum.

**18.11.2026 · 0.6.6, Buschcheck Etappe D (#1287, Tag `v0.6.6`)** — Zeitgrenze 15 s für Tages-, Monats- und Statistikabrufe; nach einem Hänger Hinweis und freie Lade-Sperre, der nächste Abruf lädt wieder (M34). Ohne Meta-Platz im Kopf keine Altersanzeige. 62 Node-Tests. Abschlusslauf `karten-20261118-181023-bd0060` grün (49/49, 1235 Node-Tests, Block `statisch` mit `sinks` grün), `--beleg-pruefen` gleich; Bilder gegen Etappe C am Bild geprüft (Sonnet), Abweichungen nur Rauschen (Uhrzeit, Kacheln, Markenlogo aus dem Netz, gegen Zwischenlauf `karten-20261118-173114-993d7a` gegengeprüft).

**18.11.2026 · 0.6.5, Buschcheck Etappe C (#1277, Tag `v0.6.5`)** — XSS-Payloadtests für alle Karten und CI-Schritt Sinks (M19), Shared UI 0.4.0. Sichtbar unverändert. 60 Node-Tests. Abschlusslauf `karten-20261118-143236-199107` grün (55/55, 2159 Node-Tests, Block `statisch` mit `sinks` grün), `--beleg-pruefen` gleich; Bilder gegen Etappe B am Bild geprüft (Sonnet), Abweichungen gewollt oder Rauschen (Uhrzeit, Kacheln, Markenlogo aus dem Netz).

**18.11.2026 · 0.6.4, Buschcheck Etappe B (#1269, Tag `v0.6.4`)** — Leaflet 1.9.4 JS und CSS als Vendor-Blöcke mit Hash, CI meldet `vendor leaflet ok` (M46); Testkit (M5). 31 Node-Tests. Keine sichtbare Änderung. Abschlusslauf `karten-20261118-131312-6dd1c4` grün (51/51, 1003 Node-Tests, Block `statisch` grün), `--beleg-pruefen` gleich; Bilder gegen Etappe A: 1836/1901 bytegleich, Rest Uhrzeit-/Animationsrauschen.

**18.11.2026 · 0.6.3, Buschcheck Etappe A (#1264, Tag `v0.6.3`)** — Auswahlmenüs der Zonenzeit-Karte ohne innerHTML (Namen als Text, M1); fehlgeschlagenes localtrack/stats wird erneut versucht. Erste Node-Testbasis mit 27 Fällen (M20). 27-zonetime sichtgeprüft (bytegleich). Abschlusslauf `karten-20261118-115150-b741a7` grün (38/38, 908 Node-Tests), `--beleg-pruefen` gleich; `node --check`, `ui-regeln-pruefen.py` (0), `hacs-contract-lint.py` (0), Kern bytegleich.

