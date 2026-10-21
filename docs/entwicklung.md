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
