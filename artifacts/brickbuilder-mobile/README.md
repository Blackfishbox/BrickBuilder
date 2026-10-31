# BrickBuilder Mobile

Eigenständige, lokale Bau-App als installierbare PWA. Die erste Version
konzentriert sich auf die mobile Konstruktion mit drei parametrisierbaren
Steinformen; sie ist kein Klon von BrickLink Studio und verwendet keine
proprietären Studio-Ressourcen.

## Phase 1: verfügbar

- Responsive Oberfläche für Hoch- und Querformat mit Touch-Werkzeugleiste,
  Steinauswahl, lokaler Suche und Farbauswahl.
- Interaktive Three.js-Szene mit Grundfläche, Raster, Snapping auf halbe
  Baueinheiten und prozeduralen 2×4-, 2×2- und 1×2-Steinen.
- Platzieren, Auswählen, Ziehen, Drehen, Löschen sowie Undo/Redo.
- Ein-Finger-Kameradrehung; Zwei-Finger-Gesten für Zoom, Drehung und Verschieben.
- InstancedMesh-Gruppierung nach Typ und Farbe im WebGL2-Modus.
- 2D-Canvas-Projektionsfallback, falls der Browser keinen WebGL2-Kontext bereitstellt.
- Lokale Projekte in IndexedDB, automatische Speicherung, Wiederherstellung und
  Projektwechsel.
- Manifest und generierter Service Worker; die gebündelte App wird für die
  Nutzung nach dem ersten Laden vorgemerkt. Ein Modellanalyse-Worker hält
  Kennzahlen und Überlappungsanalyse aus dem UI-Thread heraus.
- Keine Konten, Server, externen Schriftarten oder kostenpflichtigen Dienste.

## Prüfung

Im Workspace erfolgreich ausgeführt:

```sh
pnpm --filter @workspace/brickbuilder-mobile run typecheck
pnpm --filter @workspace/brickbuilder-mobile run test
PORT=23048 BASE_PATH=/ pnpm --filter @workspace/brickbuilder-mobile run build
```

Die Tests decken Raster/Snapping, Drehungen, Undo/Redo und IndexedDB-Grundlagen
ab. Der Produktionsbuild erzeugt `manifest.webmanifest` und `sw.js`; die
Three.js-Engine wird separat und verzögert geladen. Der eigentliche
Three.js-Chunk ist rund 536 kB unkomprimiert (132 kB gzip), was bei späteren
Leistungstests auf Android berücksichtigt werden sollte.

Die Vorschau wurde bei 402×874 und 844×402 Pixeln geprüft. Die
Vorschau-Umgebung stellt keinen WebGL2-Kontext bereit und zeigt daher den
Canvas-Fallback. Ein echtes Android-Smartphone und der WebGL2-Pfad wurden hier
nicht physisch geprüft. Ebenso steht ein tatsächlicher Flugmodus-Test im
installierten Browser noch aus; die Offline-Erzeugung und der Cache-Inhalt des
Produktionsbuilds wurden geprüft, nicht ein vollständiger Offline-Browserlauf.

## Noch nicht enthalten

- LDraw-Teilebibliothek, Paket-Downloads, Lizenzhinweise pro Teilepaket und
  Katalogsuche über die drei Phase-1-Steine hinaus.
- BrickLink-IDs, Farbmapping, Preise oder Verfügbarkeitsdaten.
- Import/Export für LDR, MPD oder IO. Es gibt keine behauptete Dateikompatibilität.
- Mehrfachauswahl, Langzeitmessungen mit tausenden Steinen oder Cloud-Sync.
- Physischer Android-Abnahmetest.

Das interne JSON-Modell ist versioniert (`schemaVersion: 1`) und besitzt ein
Metadatenfeld für zukünftige Importer. LDraw- und BrickLink-Nummern sind nicht
mit den internen Stein-IDs gleichzusetzen. Die getrennte Formatarchitektur,
Lizenzgrenzen und spätere Prüfschritte sind in
[`docs/architecture.md`](docs/architecture.md) festgehalten.

## Entwicklung

```sh
# Replit injects PORT and BASE_PATH through the managed workflow.
# For a local checkout:
PORT=4173 BASE_PATH=/ pnpm --filter @workspace/brickbuilder-mobile run dev
pnpm --filter @workspace/brickbuilder-mobile run typecheck
pnpm --filter @workspace/brickbuilder-mobile run test
```
