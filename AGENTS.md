# Codex — HACS-Erweiterung

## Verbindliche Designrichtlinien

Vor Planung oder Implementierung vollständig
`/mnt/user/Data/Claude Projekte/DESIGN_GUIDELINES.md` lesen; anschließend
[Projektglossar](docs/design-glossar.md) und
[Design-Audit](docs/design-audit-2026-10-08.md) beachten. Vor UI-Arbeit alle
26 Regel-IDs auf Anwendbarkeit prüfen und die betroffenen Regeln nachher
belegen. Ein Quellenbefund ersetzt keine Tastatur-, Mobile- oder PWA-Abnahme.
Bestehende Marke und strengere Projektregeln erhalten; Konflikte explizit
benennen. Fehlt die zentrale Datei bei einem Einzel-Checkout, die fehlende
Quelle benennen und vor UI-Planung/Implementierung bereitstellen lassen.


Lies vor Aenderungen `../AGENTS.md` und `../CLAUDE.md` sowie die dort
verlangten UI-, Test- und Auslieferungsregeln. Dieses Verzeichnis ist ein
eigenes Repository; fuehre Git-Befehle hier aus und mische keine Nachbarrepos.
Falls der uebergeordnete HACS-Arbeitsbereich bei einem Einzel-Checkout fehlt,
benenne das fehlende Regelwerk; nutze vorhandene lokale Projektdokumentation
und klaere die fehlenden Auslieferungsregeln vor einer Veroeffentlichung.


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
