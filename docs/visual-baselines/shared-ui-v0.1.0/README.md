# Local Track Cards — Busch HA UI 0.1.0

Akzeptierte visuelle Baseline vom 25.09.2026. Alle Bilder stammen aus
synthetischen Browser-Fixtures; sie enthalten keine echten Home-Assistant-Daten.
Die Route nutzt öffentliche Testkoordinaten in Berlin. Personen, Zonen und
lange Namen sind erfunden.

`timeline-*` und `zonetime-*` zeigen jeweils Karte und Editor bei 320, 480 und
960 px, in hell und dunkel (24 Bilder). Zusätzlich zeigen 16 Bilder bei 320 px
die Zustände Laden, Leer, Fehler und fehlende Daten in beiden Themen. Die
Editorbilder verwenden eine `ha-form`-Attrappe, die Schema, Labels und Helper
des ausgelieferten Editors zeigt; das echte HA-Frontend wurde nicht gerendert.

Erzeugung und Geometrieprüfung: `docs/render/shared_ui_contract.py`. Der Test
prüft Text, Kollisionen, 44-px-Aktionen, Fokus und Zustandswechsel. Live-Kacheln
von OpenStreetMap können sich ändern; die Bilder sind daher eine visuelle
Referenz und kein Pixel-Hash-Test.
