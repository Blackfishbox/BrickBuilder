import { useEffect, type CSSProperties } from "react";
import { Check } from "lucide-react";
import { ensureColorEvidence, useColorEvidence } from "./client";
import { evidencePalette, selectionColorEvidence, type EvidenceSwatch } from "./color-evidence";
import manifest from "./color-evidence-manifest.json";

interface Props {
  palette: EvidenceSwatch[];
  current: EvidenceSwatch[];
  references: string[];
  locked: boolean;
  mobile?: boolean;
  onChange(color: EvidenceSwatch): void;
}
export default function EvidencedColorPicker({ palette, current, references, locked, mobile, onChange }: Props) {
  const evidence = useColorEvidence();
  useEffect(() => { void ensureColorEvidence().catch(() => undefined); }, []);
  const result = selectionColorEvidence(references, evidence.index);
  const { visible, preserved } = evidencePalette(palette, result.codes, current);
  const selected = (code: string) => current.some(c => c.ldrawCode === code);
  return <>
    <p className="color-evidence-status" role="status" data-testid="color-evidence-status">
      {locked ? "Teilelistenfarbe fest vorgegeben. Sie bleibt unverändert." : result.known
        ? `${result.known > 1 ? "Gemeinsam nachgewiesene" : "Nachgewiesene"} Farben · Stand ${manifest.snapshotDate}.`
        : "Farbverfügbarkeit unbekannt – freie Palette."}
      {!locked && result.known > 0 && result.codes?.length === 0 && " Keine gemeinsam eindeutig zugeordneten Farben im Snapshot."}
      {result.unknown > 0 && result.known > 0 && ` ${result.unknown} Teil(e) ohne Nachweis schränken die Auswahl nicht ein.`}
      {result.ambiguous > 0 && ` ${result.ambiguous} mehrdeutige Teilezuordnung(en): keine Einschränkung daraus abgeleitet.`}
      {result.unmappedColors > 0 && ` ${result.unmappedColors} beobachtete RB-Farbzuordnung(en) ohne eindeutigen LDraw-Farbcode.`}
      {evidence.status === "loading" && " Lokale Nachweise werden geladen …"}
      {evidence.status === "error" && <> {evidence.error} <button type="button" onClick={() => void ensureColorEvidence().catch(() => undefined)}>Erneut prüfen</button></>}
    </p>
    <div className={mobile ? "mobile-color-grid" : "color-grid"} role="group" aria-label="Steinfarbe"
      style={{ maxHeight: mobile ? "45vh" : 180, overflowY: "auto" }}>
      {visible.map(color => <button key={color.ldrawCode} type="button"
        className={`${mobile ? "mobile-color-option" : "swatch"} ${selected(color.ldrawCode) ? "selected" : ""}`}
        style={mobile ? undefined : { "--swatch-color": color.value } as CSSProperties}
        aria-label={`${color.name} auswählen`} aria-pressed={selected(color.ldrawCode)}
        disabled={locked} onClick={() => onChange(color)}
        data-testid={`${mobile ? "mobile" : "button"}-color-${color.name.toLowerCase()}`}>
        {mobile && <><span style={{ "--swatch-color": color.value } as CSSProperties} /><span>{color.name}</span></>}
        {selected(color.ldrawCode) && <Check size={mobile ? 16 : 13} />}
      </button>)}
    </div>
    {preserved.length > 0 && <div className="color-evidence-status" data-testid="preserved-colors">
      <strong>Aktuelle Farben bleiben erhalten</strong>
      {preserved.map(color => <div key={color.ldrawCode}>
        <span className="preserved-color-dot" style={{ background: color.value }} />
        {color.name} · LDraw {color.ldrawCode} · {result.codes === undefined ? "nicht in der Palette" : "nicht gemeinsam nachgewiesen"}
      </div>)}
    </div>}
    <details className="color-evidence-status"><summary>Herkunft und Grenzen der Farbnachweise</summary>
      <p>Rebrickable-Elementtabelle · {manifest.snapshotDate}. Beobachtete Kombinationen sind kein BrickLink-Lagerbestand,
        keine Preisangabe und kein vollständiger Nachweis aller jemals hergestellten Farben.
        Fehlender Nachweis bedeutet nicht „unmöglich“. Varianten werden nur über exakte, eindeutige LDraw-Zuordnungen verwendet.</p>
      <p>{manifest.attribution} {manifest.license}</p>
      <p><a href="https://rebrickable.com/downloads/" target="_blank" rel="noreferrer">Datenquelle</a>
        {" · "}<a href={manifest.termsUrl} target="_blank" rel="noreferrer">Nutzungsbedingungen</a></p>
    </details>
  </>;
}
