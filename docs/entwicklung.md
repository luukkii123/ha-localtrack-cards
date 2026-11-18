# Entwicklung

Hinweise für alle, die an den Karten mitarbeiten. Nutzer brauchen sie nicht.

## Kein Build-Schritt

`dist/localtrack-cards.js` ist Quelltext und Auslieferung in einem: Vanilla-JS
mit Custom Elements, kein Bundler. Eine HACS-Dashboard-Ressource liefert genau
eine Datei aus, Unterordner erreichen den Browser nie. Deshalb steckt
**Leaflet 1.9.4** (BSD-2-Clause) vollständig in der Datei: die UMD-Fassung, das
CSS als injizierter `<style>`, die vier Marker-PNGs als `data:`-URIs (Abschnitt
`BEGIN VENDOR` bis `END VENDOR`). Nachgeladen werden nur Kartenkacheln. Das
erklärt die Dateigröße von rund 270 kB.

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
| `render.py` | Timeline-Karte: Textüberlauf, Kollisionen, Hell/Dunkel bei 320/480/960 px, Netzanfragen (Seite, JS, Kacheln; keine Nachladung aus Unterordnern) |
| `zonetime.py` | Verweildauer-Karte: dasselbe, dazu Sprachen und Tageszeilen |
| `zindex.py` | Stapelkontext der Karte gegen Dialogschichten (Leaflet vergibt hohe z-index-Werte; der Host der Karte bildet deshalb einen eigenen Stapelkontext) |
| `editor_contract.py` | beide Editoren: unveränderte Werte lösen kein erneutes Form-Update aus, `0` und `false` bleiben erhalten, verschachtelte Werte sind vom Eingabeobjekt isoliert, `keydown`/`keyup` verlassen den Editor nicht |
| `shared_ui_contract.py` | beide Karten und Editoren: lange Namen, Lade-, Leer-, Fehler- und Datenzustände, 44-px-Aktionsflächen, Tastaturfokus; erzeugt die Bilder unter `docs/visual-baselines/` |

Die Skripte laufen in einem Playwright-Container
(`mcr.microsoft.com/playwright/python:v1.62.0-noble`). Der `docker run`-Aufruf
steht im Kopf des jeweiligen Skripts. Sie benötigen zusätzlich das Messmodul
`regeln.py` aus dem lokalen Verwaltungsordner des Maintainers, das nicht Teil
dieses Repositories ist; ohne es laufen sie nicht.

Die Bilder in `docs/visual-baselines/shared-ui-v0.1.0/` sind eine visuelle
Referenz, kein Pixel-Hash-Test: Kacheln von OpenStreetMap können sich ändern.
Sie zeigen ausschließlich synthetische Daten (Route in Berlin, erfundene
Personen und Zonen).

Das Datumsfeld der Timeline zeigt in den Bildern `MM/TT/JJJJ`. Das ist ein
Artefakt des Headless-Chromiums; im Browser des Nutzers steht das Datum in der
eingestellten Sprache.

## Technische Hinweise

- **Timeline:** Aufenthalte werden zuerst gegen die Zonen aus Home Assistant
  benannt (kleinste passende Zone gewinnt), sonst „Aufenthalt" oder mit
  `reverse_geocode` der Nominatim-Name. Zwei Aufenthalte am selben Ort stapeln
  ihre Nadeln, die Liste zeigt beide. Liegen mehr Punkte vor als `max_points`,
  vereinfacht die Integration sie mit Douglas-Peucker, bevor die Karte sie sieht.
  Steht das Datum auf heute, lädt die Karte nach einer Positionsänderung mit
  rund 30 Sekunden Verzögerung nach; Scrubber, Fokus und Scroll bleiben dabei
  erhalten.
- **Verweildauer:** Die Karte rechnet nicht selbst, alle Zahlen kommen aus
  `localtrack/zone_time`. Die Menüs füllen sich aus `localtrack/stats` (Personen)
  und den Zonen von Home Assistant mit Mittelpunkt und Radius. Die Vorbelegung
  im Kartenwähler ist die kleinste Zone außer `zone.home`. Unter 380 px Breite
  entfällt der Balken.
- **Editor:** `getConfigForm` wird bewusst nicht verwendet. Der Editor liefert
  Label und Helper zweisprachig, zeigt die Vorgaben der Verweildauer-Karte nur an
  (beim Speichern landen nur Abweichungen in der Konfiguration) und lässt die
  dynamischen `getStubConfig`-Vorschläge für Person und Zone bestehen.
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

**18.11.2026 · 0.6.6, Buschcheck Etappe D (#1287, Tag `v0.6.6`)** — Zeitgrenze 15 s für Tages-, Monats- und Statistikabrufe; nach einem Hänger Hinweis und freie Lade-Sperre, der nächste Abruf lädt wieder (M34). Ohne Meta-Platz im Kopf keine Altersanzeige. 62 Node-Tests. Abschlusslauf `karten-20261118-181023-bd0060` grün (49/49, 1235 Node-Tests, Block `statisch` mit `sinks` grün), `--beleg-pruefen` gleich; Bilder gegen Etappe C am Bild geprüft (Sonnet), Abweichungen nur Rauschen (Uhrzeit, Kacheln, Markenlogo aus dem Netz, gegen Zwischenlauf `karten-20261118-173114-993d7a` gegengeprüft).

**18.11.2026 · 0.6.5, Buschcheck Etappe C (#1277, Tag `v0.6.5`)** — XSS-Payloadtests für alle Karten und CI-Schritt Sinks (M19), Shared UI 0.4.0. Sichtbar unverändert. 60 Node-Tests. Abschlusslauf `karten-20261118-143236-199107` grün (55/55, 2159 Node-Tests, Block `statisch` mit `sinks` grün), `--beleg-pruefen` gleich; Bilder gegen Etappe B am Bild geprüft (Sonnet), Abweichungen gewollt oder Rauschen (Uhrzeit, Kacheln, Markenlogo aus dem Netz).

**18.11.2026 · 0.6.4, Buschcheck Etappe B (#1269, Tag `v0.6.4`)** — Leaflet 1.9.4 JS und CSS als Vendor-Blöcke mit Hash, CI meldet `vendor leaflet ok` (M46); Testkit (M5). 31 Node-Tests. Keine sichtbare Änderung. Abschlusslauf `karten-20261118-131312-6dd1c4` grün (51/51, 1003 Node-Tests, Block `statisch` grün), `--beleg-pruefen` gleich; Bilder gegen Etappe A: 1836/1901 bytegleich, Rest Uhrzeit-/Animationsrauschen.

**18.11.2026 · 0.6.3, Buschcheck Etappe A (#1264, Tag `v0.6.3`)** — Auswahlmenüs der Zonenzeit-Karte ohne innerHTML (Namen als Text, M1); fehlgeschlagenes localtrack/stats wird erneut versucht. Erste Node-Testbasis mit 27 Fällen (M20). 27-zonetime sichtgeprüft (bytegleich). Abschlusslauf `karten-20261118-115150-b741a7` grün (38/38, 908 Node-Tests), `--beleg-pruefen` gleich; `node --check`, `ui-regeln-pruefen.py` (0), `hacs-contract-lint.py` (0), Kern bytegleich.

