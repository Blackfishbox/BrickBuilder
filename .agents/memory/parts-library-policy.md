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

**How to apply:** Bei neuen Paketen alle rekursiven Abhängigkeiten und
Originalcredits mitprüfen, Rechtstexte lokal mitliefern und neue Snapshots
bewusst freigeben. Die dokumentierte Prüfung ist keine anwaltliche Beratung.
