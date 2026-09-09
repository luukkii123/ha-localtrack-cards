# Local Track Cards

**Zwei Lovelace-Karten zu Local Track: der Tagesverlauf einer Person auf der
Landkarte, und wie lange sie an einem Ort war — Monat für Monat.**

![Die Timeline-Karte: Route, nummerierte Aufenthalte, Scrubber und Segmentliste](docs/preview-timeline.png)

| Karte | Wofür |
| --- | --- |
| `localtrack-timeline-card` | Tages-Track einer `person.*`- oder `device_tracker.*`-Entität |
| `localtrack-zone-time-card` | Verweildauer an einem Ort, ein Monat als Tagesliste |

Beide sind über *Karte hinzufügen* einrichtbar — mit Vorschau und grafischem
Editor, ohne eine Zeile YAML.

> **Die Landkarten-Karte ist umgezogen.** `localtrack-map-card` heißt seit dem
> 06.09.2026 **`busch-map-card`** und liegt in
> [ha-busch-cards](https://github.com/luukkii123/ha-busch-cards). Sie brauchte
> Local Track nie — dort gehört sie hin, zu den Karten ohne eigene
> Integration.

## Voraussetzung

Die Karte braucht die Integration
[**Local Track**](https://github.com/luukkii123/ha-localtrack-integrations) —
sie liefert die WebSocket-Kommandos, über die die Karten ausschließlich lesen:
`localtrack/history` für die Timeline-Karte, **`localtrack/zone_time` für die
Verweildauer-Karte — das gibt es erst ab Integration `v0.3.0`**. Die Karte spricht nie mit einem Dritten, außer für die
Kartenkacheln (siehe *Grenzen*).

Ist die Integration installiert, aber kein Eintrag angelegt, meldet die Karte
„Local Track ist nicht eingerichtet — Einstellungen → Geräte & Dienste →
Integration hinzufügen → Local Track."; geht die Abfrage aus einem anderen
Grund schief, „Daten konnten nicht geladen werden: …". **Beide Karten sprechen
Deutsch und Englisch**, nach `hass.locale.language`; in der Kartenauswahl
entscheidet `navigator.language`.

Warum zwei Repos: In HACS gehört ein Repository zu **genau einer** Kategorie.
Karten und Integrationen lassen sich deshalb nicht zusammen ausliefern.

## Installation über HACS

1. HACS → ⋮ → **Custom repositories**
2. Repository: `https://github.com/luukkii123/ha-localtrack-cards`,
   Kategorie: **Dashboard**
3. **Local Track Cards** herunterladen, Seite hart neu laden (Strg+F5) — sonst
   hängt die alte Datei im Cache.
4. Karte auf ein Dashboard legen: sie erscheint in der Kartenauswahl als
   **Local Track Timeline**, mit Vorschau und grafischem Editor.

Manuell: `dist/localtrack-cards.js` nach `<config>/www/localtrack-cards.js`
kopieren und unter Einstellungen → Dashboards → ⋮ → **Ressourcen** eintragen:
`/local/localtrack-cards.js`, Typ **JavaScript-Modul**.

Voraussetzung: Home Assistant **2024.11.0** oder neuer.

```yaml
type: custom:localtrack-timeline-card
entity: person.beispiel
title: Mein Tag         # optional, sonst der Name der Person
height: 320             # Kartenhöhe in px
stay_radius_m: 150      # Radius, in dem Punkte als „Aufenthalt" gelten
min_stay_minutes: 10    # Mindestdauer eines Aufenthalts
show_scrubber: true     # Zeit-Scrubber ein-/ausblenden
reverse_geocode: false  # Ortsnamen über OSM/Nominatim abfragen
max_points: 2000        # max. Punkte pro Tag
tile_url: ""            # leer = OpenStreetMap, sonst eigener Kachelserver
```

## Optionen

| Option | Pflicht | Standard | Bedeutung |
| --- | --- | --- | --- |
| `entity` | ja | — | eine `person.*`- oder `device_tracker.*`-Entität |
| `title` | nein | Name der Person | Überschrift der Karte; ohne `title` der `friendly_name`, sonst die Entitäts-ID |
| `height` | nein | `320` | Kartenhöhe in px (Editor: 240–720) |
| `stay_radius_m` | nein | `150` | bis zu diesem Abstand vom laufenden Mittelpunkt zählen Punkte als ein Aufenthalt (Editor: 10–1000) |
| `min_stay_minutes` | nein | `10` | so lange muss ein Aufenthalt gedauert haben, um zu zählen (Editor: 1–240) |
| `show_scrubber` | nein | `true` | Zeit-Scrubber unter der Karte anzeigen |
| `reverse_geocode` | nein | `false` | Aufenthalte ohne passende Zone über OSM/Nominatim benennen |
| `max_points` | nein | `2000` | so viele Punkte holt die Karte höchstens (Editor: 100–5000) |
| `tile_url` | nein | leer | leer = OpenStreetMap, sonst eine eigene Kachel-URL im Leaflet-Format |

## Bedienung

- **Datum** oben rechts wählen (Standard: heute); die Karte lädt den Track
  dieses Tages.
- **Zeit-Scrubber** unter der Karte: entlang der Route fahren, daneben stehen
  Uhrzeit und Zone (oder „unterwegs").
- **Aufenthalte** und **Strecken** erscheinen als Liste unter der Karte, mit
  Zeitspanne und Dauer bzw. Länge in Kilometern. Ein Klick zentriert die Karte
  darauf.
- Start (grün) und Ende (rot) sind markiert, Aufenthalte als nummerierte Pins in
  der Reihenfolge des Tages.

Aufenthalte werden zuerst gegen die **Zonen** von Home Assistant beschriftet;
passt keine, heißt der Eintrag „Aufenthalt" — oder, mit
`reverse_geocode: true`, wie der von OSM gelieferte Straßen- bzw. Ortsname.

Steht das Datum auf **heute**, lädt die Karte nach einer Positionsänderung
verzögert nach (rund 30 Sekunden). Vergangene Tage ändern sich nicht und werden
nicht neu geladen.

Auf schmalen Spalten rückt die Karte zusammen, die Segmentliste bleibt lesbar:

<img src="docs/preview-timeline-mobile.png" width="330" alt="Die Timeline-Karte in einer schmalen Spalte">

## Grenzen

- **Noch nicht in einem laufenden Home Assistant getestet.** Die Karte wurde in
  einem Chromium-Container gegen erfundene Daten gerendert; das Zusammenspiel
  mit einer echten Installation steht aus.
- **Kartenkacheln kommen von openstreetmap.org**, solange `tile_url` leer ist.
  Wer das nicht will, trägt einen eigenen Kachelserver ein.
- **`reverse_geocode: true` schickt Koordinaten an einen Dritten**
  (nominatim.openstreetmap.org). Standardmäßig ist das aus; die Zonen-Zuordnung
  bleibt vollständig lokal.
- **Die Routenqualität hängt an der Quelle, nicht am Code.** Die Companion-App
  meldet den Standort im Standardmodus nur bei deutlicher Bewegung oder
  Zonenwechsel — die Linien zwischen den Punkten sind dann gerade. „Hohe
  Genauigkeit" in der App (kostet Akku) liefert dichtere Spuren.
- **Ein Tag auf einmal.** Es gibt keine Wochen- oder Monatsansicht und keinen
  Vergleich mehrerer Personen in einer Karte.
- **Zwei Aufenthalte am selben Ort stapeln ihre Nadeln.** Wer morgens und
  abends zu Hause ist, sieht dort nur die spätere Nummer — die frühere liegt
  exakt darunter. Im Bild oben fehlt deshalb die 1. Die Liste unter der Karte
  zeigt beide.
- Liegen mehr Punkte vor als `max_points`, reduziert die **Integration** sie mit
  Douglas-Peucker, bevor die Karte sie sieht.
- Das Datumsfeld zeigt in den Bildern oben `08/24/2026` statt `24.08.2026`. Das
  ist ein Artefakt des Headless-Chromium, der `<input type="date">` fest
  englisch formatiert. Im Browser des Nutzers steht das Datum deutsch.

## Kein Build-Schritt

`dist/localtrack-cards.js` ist Quelltext und Auslieferung in einem: reines
Vanilla-JS mit Custom Elements, kein Bundler. **Keine Unterordner** — eine
HACS-Dashboard-Ressource liefert genau eine Datei aus, alles darunter erreicht
den Browser nie.

Deshalb steckt **Leaflet 1.9.4** (BSD-2-Clause) vollständig in dieser Datei:
die UMD-Fassung, das CSS als injizierter `<style>`, die vier Marker-PNGs als
`data:`-URIs. Nachgeladen wird nichts außer den Kartenkacheln. Das erklärt die
Dateigröße von rund 200 kB. Der Lizenzkopf von Leaflet steht unverändert im
Abschnitt zwischen `BEGIN VENDOR` und `END VENDOR`.

## Geprüft

Das Bild oben stammt aus `docs/render/render.py`: Die ausgelieferte Datei wird
in echtem Chromium gerendert, `ha-card`/`ha-icon`/`ha-form` sind Attrappen, und
`callWS` beantwortet `localtrack/history` mit einem erfundenen Tagesverlauf.

Der Aufruf braucht **beide** Mounts: `/work` ist `hacs/docs/render` (dort liegt
das Messmodul `regeln.py`), `/cards` ist dieses Repo.

```bash
docker run --rm \
  -v "/mnt/user/Data/Claude Projekte/hacs/docs/render:/work" \
  -v "/mnt/user/Data/Claude Projekte/hacs/ha-localtrack-cards:/cards" \
  --entrypoint bash mcr.microsoft.com/playwright/python:v1.62.0-noble \
  -c 'pip install --quiet --break-system-packages playwright==1.62.0 >/dev/null; \
      python3 /cards/docs/render/render.py /cards/dist/localtrack-cards.js \
              /cards/docs/render/ergebnis 620'
```

Der Lauf protokolliert **jede** Netzanfrage nach `report.json`. Bei 620 px
waren es 11 Anfragen — Seite, JS-Datei und 9 Kartenkacheln —, alle
Fehlerlisten (`vendor_requests`, `bad_responses`, `request_failures`,
`console_errors`, `page_errors`) leer. Marker und Schatten kamen als
`data:`-URIs an (50×82 bzw. 41×41 px), es gab **keinen** Versuch, aus einem
Unterordner nachzuladen.

### UI-Regeln — Stand 09.09.2026, `CARD_VERSION` 0.4.0

Gemessen gegen [`docs/ui-regeln.md`](https://github.com/luukkii123/hacs) im
Sammelordner, alle vier Regeln, beide Karten. **Alles grün, Exit 0.**

| Beleg | Umfang | Ergebnis |
| --- | --- | --- |
| `python3 scripts/ui-regeln-pruefen.py --repo ha-localtrack-cards` | statisch, Regel 3 und 4 | 0 Verstöße (vorher 18) |
| `docs/render/render.py` (Timeline) | 30 Prüfungen; Regel 1 bei 320/480/960 px × hell/dunkel, zusätzlich derselbe Satz im Fehlerzustand | 138 + 108 gemessene Textelemente, 0 Überlauf, 0 außerhalb, 0 Überlappung |
| `docs/render/zonetime.py` (Verweildauer) | 50 Prüfungen; Regel 1 bei 320/480/960 px × hell/dunkel | 636 gemessene Textelemente, 0 Überlauf, 0 außerhalb, 0 Überlappung |
| `docs/render/zindex.py` | Stapelkontext gegen die Dialogschicht | unverändert grün |

Was dabei **nicht** nur behauptet, sondern gemessen wurde:

- **Regel 1:** Vor jeder Messung läuft `selbsttest` — zwei Sonden, eine
  fehlerhafte und eine korrekt gekürzte. Ohne die erste wäre ein Lauf mit null
  Verstößen wertlos, ohne die zweite gälte jede gewollte Kürzung als Fehler.
  Beide schlugen richtig an.
- **Regel 1, Tabelle:** `table-layout: fixed` ist gemessen, nicht angenommen.
  Eine absichtlich überfüllte Zelle bleibt bei 163 px, die Tabelle bei 288 px,
  und der Inhalt wird bei `scrollWidth` 524 gegen `clientWidth` 163 gekürzt.
- **Regel 2:** Die Karten haben **keine** Popups — auch das ist ein Messwert.
  Nach 14 ausgelösten Klicks auf Segmentzeilen, Aufenthaltsnadeln, Route und
  Landkarte gab es 0 Leaflet-Popups, 0 Tooltips, 0 Dialoge, die Popup-Ebene
  blieb leer, `location.href` und `history.length` unverändert.
- **Regel 3:** Der ausgelieferte Text ist geprüft, nicht das Vorhandensein der
  Funktionen: alle 9 bzw. 6 Schemafelder liefern Label **und** Helper in
  deutsch **und** englisch, die Sprachen unterscheiden sich, jeder Helper endet
  auf einen Punkt, kein Label tut es.
- **Regel 4:** Beide Karten rendern in `<ha-card>` mit `var(--ha-space-4)`, und
  jede Messung lief in beiden Themen.

**Nicht belegt:** Der Editor ist gegen eine `ha-form`-**Attrappe** gemessen.
Dass Home Assistants echtes `ha-form` diese Selektoren so darstellt und den
Helper anzeigt, entscheidet erst der Live-Test.

## Herkunft

Die Karte hieß bis Version 0.3.0 von
[`ha-busch-cards`](https://github.com/luukkii123/ha-busch-cards)
`busch-timeline-card` und lag dort in derselben Datei wie die Zeitplan-Karte.
Sie ist hierher umgezogen, weil sie zur Integration `localtrack` gehört: ein
gemeinsames Repo hieße eine gemeinsame Version und ein gemeinsames Release für
Karten, die nichts miteinander zu tun haben. Wer den Zeitplan-Editor will,
sollte nicht Leaflet mitinstallieren müssen.

**Wer die alte Karte auf einem Dashboard hat**, ändert `type:` von
`custom:busch-timeline-card` auf `custom:localtrack-timeline-card`. Die
Optionen sind unverändert.


## Die Verweildauer-Karte

`localtrack-zone-time-card` beantwortet „wie lange war ich diesen Monat bei der
Arbeit". Person und Ort sind Ausklappmenüs, der Monat wird geblättert.

```yaml
type: custom:localtrack-zone-time-card
entity: person.beispiel        # Anfangsauswahl, im Menü umschaltbar
zone: zone.arbeit              # Anfangsauswahl, im Menü umschaltbar
title: Verweildauer            # optional, sonst der Name der Zone
min_visit_minutes: 5           # optional
max_gap_minutes: 30            # optional
show_gross: true               # optional
```

| Option | Standard | Wirkung |
| --- | --- | --- |
| `entity` | — | Pflicht. `person.*` oder `device_tracker.*` |
| `zone` | — | Pflicht. Eine `zone.*` mit Mittelpunkt und Radius |
| `title` | Name der Zone | Überschrift |
| `min_visit_minutes` | 5 | Kürzere Aufenthalte zählen **gar nicht** |
| `max_gap_minutes` | 30 | So viel wird von einer Datenlücke höchstens gutgeschrieben |
| `show_gross` | `true` | Bruttospalte ein- oder ausblenden |

**Die Menüs füllen sich selbst.** Personen kommen aus `localtrack/stats`, also
aus dem, was die Integration *gerade* aufzeichnet — nicht aus allen Entitäten
des Systems. Zonen kommen aus Home Assistant, aber nur die mit Mittelpunkt und
Radius; ohne die lässt sich nichts rechnen.

### netto und brutto

| Spalte | Bedeutung |
| --- | --- |
| netto | Summe der Zeit tatsächlich am Ort |
| brutto | erste Ankunft bis letzte Abfahrt desselben Tages |

Die Differenz ist die Zeit außerhalb — Mittagspause, Botengang, oder ein
Datenloch. Ist das Handy zwei Stunden aus, schreibt netto nur
`max_gap_minutes` gut, statt zwei Stunden zu erfinden; brutto zeigt die Spanne
trotzdem. **Lieber zu wenig als erfunden** ist die Regel, und die zweite Spalte
macht die Lücke sichtbar, statt sie zu verstecken.

**Wenn netto viel kleiner als brutto ist, liegt es meist am Handy.** Die
Companion-App meldet nach Bewegung, nicht nach Uhr: an einem Tag unterwegs
kamen 4232 Punkte im 30-Sekunden-Takt, an einem Tag zu Hause nur 141 mit
Lücken über einer Stunde. Ein guter Hinweis steht unter der Liste — zerfällt
ein Tag in zwanzig Aufenthalte, ist `max_gap_minutes` zu niedrig. 60 Minuten
sind für Sitztage vertretbar; höher wird es riskant, weil dann eine echte
Abwesenheit als Anwesenheit durchgeht.

**`min_visit_minutes` ist wichtiger, als es aussieht.** Eine Zone mit 19 m
Radius ist kleiner als die übliche GPS-Streuung; ohne die Schwelle sammelt
jede Vorbeifahrt Sekunden, und über einen Monat wird daraus eine sichtbare
Zahl, die nichts bedeutet.

**Auf schmalen Karten** (unter 380 px) entfällt der Balken; die Nettozahl
bleibt, denn wegen der sieht man hin.

### Grenzen

- **Ein Ort je Karte.** Wer Arbeit und Schule nebeneinander will, legt zwei
  Karten. Ein Vergleich zweier Orte in einer Ansicht ist nicht gebaut.
- **Keine Besuchsliste je Tag.** Die Zeile bleibt eine Zeile; die einzelnen
  Ankünfte zeigt die Timeline-Karte.
- **Kein Sollzeit-Vergleich.** „Überstunden" bräuchte Feiertage, Urlaub und ein
  Arbeitszeitmodell — das ist ein eigenes Thema, kein Feld in dieser Karte.
- **Die Karte rechnet nicht selbst.** Alle Zahlen kommen aus
  `localtrack/zone_time`; wer die Regeln nachlesen will, findet sie im README
  der Integration.


## Lizenz

MIT — siehe [LICENSE](LICENSE). Das eingebettete Leaflet steht unter
BSD-2-Clause, (c) 2010–2023 Vladimir Agafonkin, (c) 2010–2011 CloudMade.
