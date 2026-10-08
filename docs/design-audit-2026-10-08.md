# Design-Audit vom 08.10.2026 — ha-localtrack-cards

Kanonische Quelle: `/mnt/user/Data/Claude Projekte/DESIGN_GUIDELINES.md`.
Umfang: Agent-Einstieg, fachliche Benennung und statische Quellenprüfung. Keine App-Codeänderung, kein Deploy und kein Upload.

## Plattform und Nachweise

Home-Assistant-Dashboardkarte als Custom Element/Shadow-DOM; HA-Theme und Companion-Host, keine eigene PWA.

Lesereihenfolge: gemeinsame `AGENTS.md` und `CLAUDE.md`, zentrale Richtlinien, Audit-/Glossarvorlage und Todo-Regel; lokale `AGENTS.md`/`CLAUDE.md`; lokale AGENTS.md → HACS AGENTS/CLAUDE und docs/ui-regeln.md; README und tatsächliches dist-Bundle.

Tatsächlich: `git status`, Dateibestand mit `rg --files`, gezielte `rg -n`-/Quelltextprüfung, Todoabruf/-Übernahme und Dokumentenprüfung. Kein Browser gestartet, keine echten Viewports (360/390 px, Tablet, Desktop) geprüft, keine echte Keyboard-/Escape-/Back-/Forward-Prüfung, keine PWA-Installation oder Offline-Geräteprobe, kein Screenreader, keine Kontrast-/Zoom-/Touchmessung, keine Web-Vitals-Feldmessung. Vorhandene Tests/ältere Abnahmen sind Quellenhinweise und wurden hier nicht erneut ausgeführt. `teilweise` meint belegte Teilstruktur; es bedeutet keine bestandene Laufzeitabnahme.

### Quellen

- **E01**: `dist/localtrack-cards.js`: Standortkarte, Verlauf und Zeitleiste; ausgelieferter JS-Quelltext ohne Build.
- **E02**: `dist/localtrack-cards.js:1–201`: eingebettetes BuschUI mit EditorBase, Action, Status und CSS-Theme-/Fokusregeln; zentrale Quelle `../shared-ui/busch-ui.js`.
- **E03**: `dist/localtrack-cards.js`: Wörterbuch/Schemata, computeLabel/computeHelper, getConfigElement/getStubConfig und Hostvertrag.
- **E04**: `../scripts/ui-regeln-pruefen.py`: tatsächlich ausgeführt, dieses Repo 0 statische Verstöße, Exit 0. Prüft strukturelle lokale UI-Regeln, keine globale Keyboard-/Dirty-/PWA-/Feldabnahme.
- **E05**: R04-Quellbefund: `dist/localtrack-cards.js` — Kein eigener Bestätigungs-/Bearbeitungsdialog im geprüften Kartenkern belegt; HA-Editor und künftige Dialoge explizit prüfen.

## Alle 26 Regeln

| Regel | Status | Beleg, Anwendbarkeit und nächste Prüfung |
| --- | --- | --- |
| R01 · Konsistenz | teilweise | E02/E03: eingebettete gemeinsame Action-/Status-/Editorhilfe; gleiche Karte/Aktion in mehreren Hostkontexten vergleichen. |
| R02 · Mehrfachauswahl | ungeprüft | E01: sinnvolle Sammelaktionen bei Standortkarte, Verlauf und Zeitleiste fachlich bestimmen; keine Ctrl/Shift-/mobile Gleichwertigkeit belegt. Nicht jede Kartenreihe benötigt Bulk. |
| R03 · Keyboard | ungeprüft | E02: sichtbarer Fokus und native Actiontasten; vollständige Keyboard-/Escape-/Shortcutprobe im HA-Shadow-DOM fehlt. |
| R04 · Modale Dialoge | ungeprüft | E05: Kein eigener Bestätigungs-/Bearbeitungsdialog im geprüften Kartenkern belegt; HA-Editor und künftige Dialoge explizit prüfen. Fokus/Datenerhalt zusätzlich real prüfen. |
| R05 · Navigation | ungeprüft | E01/E05: Hostnavigation und Editorwege; Browser Back/Forward/Deep Links und ungespeicherte Änderungen real prüfen. |
| R06 · Responsive Mobile | ungeprüft | E01/E02: CSS-Hostlayout und 44px-Actionhilfe vorhanden; 320/360/390/480/960 px, Theme, Touch und Überlauf nicht aktuell gemessen. |
| R07 · PWA | nicht anwendbar | HACS-Karte ist eingebettet in HA-Webapp/Companion App; kein eigenes Manifest, scope oder PWA installieren. Karten müssen dennoch Offline-/Unavailable-Datenzustand richtig anzeigen, siehe R18. |
| R08 · Wiederverwendung | teilweise | E02/E03: EditorBase/ha-form zentral; identische fachliche Editor-/Pickerwege im Host real vergleichen. |
| R09 · Designsystem | teilweise | E02/E04: BuschUI mit HA-Tokens und Statussemantik; tatsächlicher Hell-/Dunkelkontrast nicht gemessen. |
| R10 · Formulare | teilweise | E03/E04: Labels/Helper/Schema strukturell geprüft; Datenerhalt/Dirty/Host-Speichern real testen. |
| R11 · Feedback | teilweise | E01/E02: Status-/Loading-/Fehlerstrukturen; Doppelklick und verzögerte HA-Serviceantwort real prüfen. |
| R12 · Fehlerbehebung | teilweise | E01/E03: Fehlerwörterbuch und Anzeige; Auswirkung/Retry/Datenhaltung unter echter Störung prüfen. |
| R13 · Destruktive Aktionen | ungeprüft | E01/E05: Speicher-/Entfernungs-/Schaltaktionen fachlich beurteilen; Undo oder eindeutige Bestätigung je irreversibler Aktion real prüfen. |
| R14 · Große Datenmengen | teilweise | E01: Standortkarte, Verlauf und Zeitleiste; Ergebniszahl/Filter/Sortier-/Paginierungs-/Rückkehrzustand mit großem synthetischem Bestand prüfen. |
| R15 · Drag&Drop | ungeprüft | E01: je vorhandener Ziehaktion Alternative ohne Ziehen prüfen (Zeitblock, Kartenkarte oder Reihenfolge); reine Karten-Pan-Geste fachlich vom Bearbeitungs-DnD trennen. |
| R16 · Accessibility | ungeprüft | E02: Fokus/ARIA-Hilfe strukturell vorhanden; Screenreader, Kontrast, Zoom/Reflow und Reduced Motion im echten HA-Host nicht geprüft. |
| R17 · Interaktionszustände | teilweise | E01/E02: StatusSemantic/focus/disabled vorhanden; selected/loading/success/error/offline je Karte real vergleichen. |
| R18 · Ansichtszustände | teilweise | E01/E03: Fehler-/Lade-/Unavailable-Strukturen; leer, forbidden, partial und Offline real injizieren. |
| R19 · Berechtigungen | nicht anwendbar | E01: keine Browserpermission-Anfrage für Kamera/Mikrofon/Push/Standort im eigenen Kartenkern; Anzeige HA-Standortdaten ist keine Browser-Geolocation. Bei neuer Funktion neu prüfen. |
| R20 · Performance | ungeprüft | E01: eingebettete Hostkarte; Requests/Refresh/Rendering und große Datenmengen nicht profiliert, keine Web-Vitals-Feldmessung. |
| R21 · UI-Präferenzen | ungeprüft | E01/E03: Kartenkonfiguration über HA persistent; temporäre Filter-/Klapp-/Datumauswahl und Rückkehrzustände real prüfen. |
| R22 · Auffindbarkeit | ungeprüft | E01/E02: sichtbare Actiontasten/Editorfelder vorhanden; sämtliche Kernfunktionen ohne Hover/Long-Press/Shortcut nachweisen. |
| R23 · Responsive Komponenten | teilweise | E02/E03: gemeinsame fachliche Karte/Editor im Host; mobile Dialog-/Layoutwechsel und Geschäftslogik real vergleichen. |
| R24 · Ausnahmen | teilweise | R07/R19-Nichtanwendbarkeit fachlich oben begründet. R04-Konflikt mit ../docs/ui-regeln.md wird zugunsten neuer globaler Nutzerregel aufgelöst; Außenklickbefund ist keine erlaubte Ausnahme. |
| R25 · Menüs/Settings | teilweise | E02: thematische Editorabschnitte/details vorhanden; lange Schemata mobil/Keyboard im nativen HA-Editor prüfen. |
| R26 · Sprache/Fachvokabular | teilweise | E03/E04: de/en-Label-/Helperfelder statisch geprüft, Fachbegriffe im Glossar; übrige Laufzeitfehler/Navigation prüfen. |

## Ausnahmen und Folgearbeit

Neue globale Nutzerregel R04 hat Vorrang: ältere pauschale Scrim-Regel gilt für flüchtige Menüs/Popovers weiter, nicht für Bearbeitungs-/Bestätigungsdialoge. Befund separat umsetzen; kein Karten-Code verändert. Vorhandene Renderer/ältere Reports wurden nicht erneut gefahren. HACS-Audit #139 umfasst aktuelle Keyboard/Mobile/Host-Editor-/Back-Prüfungen.


## Runtime-Nachtrag #139 am 08.10.2026

Der initiale Quellaudit oben bleibt historischer Befund. Die folgende Matrix
ersetzt dessen ungeprüfte Runtimeeinordnung nur im tatsächlich belegten Umfang.
Vollständige Methoden/Artefakte/Grenzen: gemeinsamer
[Runtimebericht](../../docs/runtime-design-audit-2026-10-08.md).

B3: Timeline138 Texturteile/0 Verstöße; Zone-Time53/53 und UI 0, deterministischer September-Uhrpin; Shared UI14 Fälle/0 Fehler incl. realeempty/error/missing;2 Editoren/18 Configcontractchecks.

| Regel | Status | Tatsächlicher Beleg und Grenze |
| --- | --- | --- |
| R01 · Konsistenz | teilweise | Busch UI-/HA-Verträge sowie bestehende Renderer/Editorchecks; Darstellung und Interaktionen im tatsächlich geprüften Umfang. |
| R02 · Mehrfachauswahl | nicht anwendbar | Nur Leseansicht ohne fachliche Sammelaktion im geprüften Bestand; Gruppenschaltung bzw. ARR-Auswahl je Repo separat. |
| R03 · Keyboard | teilweise | Native Buttons/Fokus sowie angegebene echte Keyboardchecks; keine vollständige Screenreader-/Shortcut-Abnahme jeder Karte. |
| R04 · Modale Dialoge | teilweise | Kein eigener Bearbeitungs-/Bestätigungsdialog; tatsächliche Timelineklicks erzeugen keine Popups. Native HA-Karteneditor-Dirty/Back nicht umfassend abgenommen. |
| R05 · Navigation | teilweise | Eigene Dialoghistory/URL soweit vorhanden geprüft; keine pauschale HA-Forward-/Deep-Link-/Refresh-Abnahme. |
| R06 · Responsive Mobile | teilweise | Genannte Breiten/Themes im echten Chromium gemessen, keine Textüberläufe. Kein echter Companion-/Safe-Area-Gerätetest. |
| R07 · PWA | nicht anwendbar | HA-/Companion-Hostkarte ohne eigenes Manifest, keine separate PWA installieren oder Offlinebearbeitung versprechen. |
| R08 · Wiederverwendung | teilweise | Einbettete Busch UI/Editor Base bzw. zentrale fachliche Helfer und Editorcontract geprüft; keine neue zweite Implementierung. |
| R09 · Designsystem | teilweise | HA-Tokens/Icons/Themes und tatsächlich angesehene Bilder; keine vollständige Kontrastmessung jeder geerbten Fläche. |
| R10 · Formulare | teilweise | Editor-/Schema-/Config-Echo-Prüfungen; native reale Save-/Dirty-Abnahme aller Hosteditoren nicht erneut ausgeführt. |
| R11 · Feedback | teilweise | Loading/Status und synthetische Service-/Fehlerverträge geprüft; keine realen Geräte-/Medienaktionen. |
| R12 · Fehlerbehebung | teilweise | Leere/Fehler-/Unavailable-Ansichten geprüft; Wiederholung/Datenerhalt je vorhandenem fachlichen Pfad, keine reale Dienststörung. |
| R13 · Destruktive Aktionen | nicht anwendbar | Keine destruktive Kartenaktion; read-only Standort-/Zeitansichten. |
| R14 · Große Datenmengen | teilweise | Synthetic Timeline-Aufenthalte und September-Zeitliste mit allen30 Tagen, keine umfassende große Historienprofilierung. |
| R15 · Drag&Drop | teilweise | Native Range-/Select/Buttons und Segmentrole/tab Index im Shared UI-Lauf geprüft; keine Bearbeitungs-Dragaktion. |
| R16 · Accessibility | teilweise | Semantik/Fokus/Touch/Reflow im genannten Umfang. Kein Screenreader und keine vollständige Kontrast-/200/400%-Browserzoomabnahme. |
| R17 · Interaktionszustände | teilweise | Normal/Fokus/disabled/loading/error/Unavailable-Fixtures; keine pauschale Vollabnahme jeder Interaktionsvariante. |
| R18 · Ansichtszustände | teilweise | Shared UI prüft reale empty/error/missing-Methoden: veraltete Zeilen/Fußwerte verschwinden. Keine physische HA-Offline-Geräteprobe. |
| R19 · Berechtigungen | nicht anwendbar | Keine eigene Browserberechtigungsanfrage. Anzeige von HA-Standortdaten ist keine Geolocation-Abfrage. |
| R20 · Performance | ungeprüft | Keine p75-LCP/INP/CLS-Feldstichprobe. Funktionale Render-/Requestzählungen und Labortests nicht als Feld-Web-Vitals ausgeben. |
| R21 · UI-Präferenzen | teilweise | Datum/Monat/Entitätsauswahl vorhanden; Host-Rückkehr-/Persistenz nicht im Audit vollständig geprüft. |
| R22 · Auffindbarkeit | teilweise | Sichtbare Buttons/Felder und Kernpfade in angegebenen Tests; keine neue nur-Hover-/Shortcut-Funktion. |
| R23 · Responsive Komponenten | teilweise | Gemeinsame fachliche Komponenten bei angegebenen mobilen/Desktop-Breiten, keine vollständige Host-/Companion-Parität behauptet. |
| R24 · Ausnahmen | teilweise | Spezifische Ausnahmen/Grenzen unten; R04 hat Vorrang vor älterer pauschaler Scrimregel. |
| R25 · Menüs/Settings | teilweise | Bestehende thematische Editoren/Settings-Verträge geprüft; nicht jede native lange HA-Auswahlliste erneut untersucht. |
| R26 · Sprache/Fachvokabular | teilweise | De/en-Wörterbücher, Labels/Helper und Repo-Glossare; tatsächliche Views soweit unten geprüft, Fachnamen bleiben erhalten. |
