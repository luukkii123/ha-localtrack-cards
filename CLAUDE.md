# ha-localtrack-cards — Agent-Einstieg

Dieses Verzeichnis ist ein eigenständiges HACS-Repository. Vor Änderungen
`AGENTS.md`, danach `../AGENTS.md` und `../CLAUDE.md` lesen und deren
Lesereihenfolge einschließlich `../docs/ui-regeln.md` beachten. Fehlende
Parent-Dateien bei einem Einzel-Checkout ausdrücklich benennen; das Regelwerk
vor UI-Arbeit bereitstellen lassen. Git-Befehle in diesem Repo ausführen,
keine Nachbarrepos oder fremden Änderungen in einen Commit aufnehmen.

Vor Planung oder Implementierung vollständig
`/mnt/user/Data/Claude Projekte/DESIGN_GUIDELINES.md` lesen, anschließend
[Projektglossar](docs/design-glossar.md) und
[aktuellen Design-Audit](docs/design-audit-2026-10-08.md). Alle 26 Regel-IDs
auf Anwendbarkeit prüfen; R04 hat Vorrang vor älteren pauschalen Scrim-Regeln.
Quellprüfung ersetzt keine echte Keyboard-/Mobile-/Hostabnahme.

Offene Todos über `bash ../../scripts/todo.sh liste hacs` abrufen; zugehörige
Bereichszuordnung steht in der HACS-Weiche. Vor Edit übernehmen, nur belegt
abschließen, Unfertiges freigeben. Gemeinsame Datenschutz- und
Benachrichtigungsregeln gelten weiter. Der Design-Audit-Auftrag vom 08.10.2026
ändert nur lokale Dokumentation: keine App-Codeänderung, kein Deploy und
keine Veröffentlichung oder Netzwerk-Git-Aktion.


## Graphify verbindlich verwenden

Nutzerauftrag 09.10.2026 fuer Claude Code, Codex und ihre Unteragenten.
Vor Architektur-, Aufrufketten-, Dateibeziehungs- oder Aenderungsfolgenfragen:

```bash
bash "/mnt/user/Data/Claude Projekte/scripts/graphify.sh" query ha-localtrack-cards "<Frage>"
```

Der Aufruf aktualisiert einen fehlenden/veralteten Graphen automatisch.
Gefundene Beziehungen am Quellcode pruefen; Graphen sind kein Test- oder
Live-Nachweis. Nach eigenen Code-/Dokumentaenderungen und nach dem Commit
`bash "/mnt/user/Data/Claude Projekte/scripts/graphify.sh" aktualisieren ha-localtrack-cards`
ausfuehren. Unteragenten erhalten diesen Ablauf samt Projektschluessel.
Massgeblich: [../../docs/graphify.md](../../docs/graphify.md).
Diese Regel ersetzt aeltere Graphify-Aufruf-/Update-Anweisungen im Projekt.
Alle Archiv-, Datenschutz-, Todo- und Auslieferungsregeln bleiben gueltig.
