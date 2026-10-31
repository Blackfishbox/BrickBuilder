---
name: Teilebibliothek und Lizenzprüfung
description: Warum Teilepakete geprüfte Snapshots statt automatisch aktualisierter Fremddaten sind.
---

LDraw-Pakete als explizit geprüfte, versionierte Snapshots behandeln; keine
automatische Aktualisierung aus dem offiziellen Live-Bestand beim App-Build.
Jedes Paket soll unabhängig installierbar sein, auch wenn gemeinsame
Primitive dadurch doppelt gespeichert werden.

**Why:** Die Lizenz ist pro Originaldatei zu prüfen, nicht allein aus dem
aktuellen Contributor Agreement abzuleiten. Eine automatische Aktualisierung
könnte ungeprüfte Lizenzen oder unvollständige Abhängigkeiten übernehmen.
Eigenständige Pakete vermeiden versteckte Download-Abhängigkeiten offline.
Die offizielle Einzeldatei-Schnittstelle begrenzt bereits relativ kleine
rekursive Sammelläufe mit HTTP 429. Für bewusst erneuerte größere Snapshots
das offizielle Komplettarchiv lokal auswerten, statt massenhaft Einzeldateien
abzurufen; nur die geprüfte Auswahl weitergeben.

**Why:** Die Einzelabrufe wurden beim Erstellen einer vollständigen
Abhängigkeitshülle gedrosselt. Das Komplettarchiv vermeidet diese Requestlast,
ohne die Prüfung pro Originaldatei zu umgehen.

**How to apply:** Bei neuen Paketen alle rekursiven Abhängigkeiten und
Originalcredits mitprüfen, Rechtstexte lokal mitliefern und neue Snapshots
bewusst freigeben. Die dokumentierte Prüfung ist keine anwaltliche Beratung.

Komprimierte, über Rohbytes gehashte Pakete nicht als `.json.gz` ausliefern.
Ein binäres Transportformat verwenden und den Hash zusätzlich über die
tatsächliche Vorschau-URL prüfen.

**Why:** Vite setzt für `.json.gz` automatisch `Content-Encoding: gzip`;
Browser und Vorschauproxy dekomprimieren dann vor `fetch().arrayBuffer()`.
Dateibasierte Tests bestehen trotzdem, während der echte Download an
Bytezahl und Hash scheitert.

**How to apply:** Bei neuen komprimierten Snapshots bewusst zwischen internem
Kompressionsformat und HTTP-Kompression unterscheiden.
