import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useState } from "react";
import { GEOMETRY_API, isAndroidBuild, remoteGeometryEnabled, setRemoteGeometryEnabled } from "./geometry-consent";

export default function PrivacyDialog({ onClose }: { onClose(): void }) {
  const [enabled, setEnabled] = useState(remoteGeometryEnabled);
  const [error, setError] = useState("");
  return <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
    <DialogContent className="max-w-3xl w-[calc(100%-24px)] p-3 sm:p-5" aria-describedby={undefined}>
      <DialogHeader><DialogTitle>Datenschutz · Android-Fassung</DialogTitle></DialogHeader>
      {isAndroidBuild() && <section className="rounded-md border p-3 text-sm">
        <label className="flex min-h-12 items-center gap-3 font-medium">
          <input type="checkbox" className="h-6 w-6 shrink-0" checked={enabled}
            onChange={event => {
              const value = event.target.checked;
              if (setRemoteGeometryEnabled(value)) { setEnabled(value); setError(""); }
              else setError("Die Einstellung konnte nicht gespeichert werden. Online-Nachladen bleibt unverändert.");
            }} />
          Fehlende Geometrien online nachladen
        </label>
        <p>Optional und standardmäßig aus. Beim Bauen oder Import werden nur fehlende
          LDraw-Dateipfade und Lizenztexte von {GEOMETRY_API} angefordert.
          Der Server erhält dabei deine IP-Adresse, Zeitpunkt und technische
          Verbindungsdaten; angefragte Teile können Rückschlüsse auf dein Modell erlauben.
          Projekte, Dateinamen und komplette Teilelisten werden nicht hochgeladen.
          Es können Mobilfunkkosten entstehen.</p>
        <p className="mt-2">Jederzeit hier deaktivierbar. Bereits gestartete Anfragen
          können noch ankommen. Geladene Teile bleiben lokal offline verfügbar.
          Nach dem Aktivieren einen fehlgeschlagenen Import erneut versuchen.</p>
        {error && <p role="alert">{error}</p>}
      </section>}
      <iframe title="Datenschutzerklärung für BrickBuilder Mobile"
        src={`${import.meta.env.BASE_URL}privacy.html`}
        className="w-full rounded-md border-0 bg-white"
        style={{ height: isAndroidBuild() ? "min(45dvh, 520px)" : "min(72dvh, 800px)" }} />
    </DialogContent>
  </Dialog>;
}
