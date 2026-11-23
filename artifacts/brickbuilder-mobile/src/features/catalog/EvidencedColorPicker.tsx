import { useEffect, type CSSProperties } from "react";
import { Check } from "lucide-react";
import { ensureColorEvidence, useColorEvidence } from "./client";
import { displayColorName, evidencePalette, selectionColorEvidence, sortColorNames, type EvidenceSwatch } from "./color-evidence";
import manifest from "./color-evidence-manifest.json";
import { useI18n } from "@/i18n/I18nProvider";

interface Props {
  palette: EvidenceSwatch[];
  current: EvidenceSwatch[];
  references: string[];
  locked: boolean;
  mobile?: boolean;
  onChange(color: EvidenceSwatch): void;
}
export default function EvidencedColorPicker({ palette, current, references, locked, mobile, onChange }: Props) {
  const { t } = useI18n();
  const evidence = useColorEvidence();
  useEffect(() => { void ensureColorEvidence().catch(() => undefined); }, []);
  const result = selectionColorEvidence(references, evidence.index);
  const { visible, preserved } = evidencePalette(palette, result.codes, current);
  const sortedVisible = sortColorNames(visible);
  const selected = (code: string) => current.some(c => c.ldrawCode === code);
  return <>
    <p className="color-evidence-status" role="status" data-testid="color-evidence-status">
      {locked ? t("color.locked") : result.known
        ? t(result.known > 1 ? "color.observedMany" : "color.observed", { date: manifest.snapshotDate })
        : t("color.unknown")}
      {!locked && result.known > 0 && result.codes?.length === 0 && t("color.noMatches")}
      {result.unknown > 0 && result.known > 0 && ` ${t(result.unknown === 1 ? "color.unknownParts" : "color.unknownPartsMany", { count: result.unknown })}`}
      {result.ambiguous > 0 && ` ${t(result.ambiguous === 1 ? "color.ambiguousParts" : "color.ambiguousPartsMany", { count: result.ambiguous })}`}
      {result.unmappedColors > 0 && ` ${t(result.unmappedColors === 1 ? "color.unmapped" : "color.unmappedMany", { count: result.unmappedColors })}`}
      {evidence.status === "loading" && t("color.loadingEvidence")}
      {evidence.status === "error" && <> {evidence.error} <button type="button" onClick={() => void ensureColorEvidence().catch(() => undefined)}>{t("color.retryEvidence")}</button></>}
    </p>
    <div className={mobile ? "mobile-color-grid" : "color-grid"} role="group" aria-label={t("color.swatches")}
      style={{ maxHeight: mobile ? "45vh" : 180, overflowY: "auto" }}>
      {sortedVisible.map(color => <button key={color.ldrawCode} type="button"
        className={`${mobile ? "mobile-color-option" : "swatch"} ${selected(color.ldrawCode) ? "selected" : ""}`}
        style={mobile ? undefined : { "--swatch-color": color.value } as CSSProperties}
        aria-label={t("color.selectName", { name: displayColorName(color.name) })} aria-pressed={selected(color.ldrawCode)}
        disabled={locked} onClick={() => onChange(color)}
        data-testid={`${mobile ? "mobile" : "button"}-color-${color.name.toLowerCase()}`}>
        {mobile && <><span style={{ "--swatch-color": color.value } as CSSProperties} /><span>{displayColorName(color.name)}</span></>}
        {selected(color.ldrawCode) && <Check size={mobile ? 16 : 13} />}
      </button>)}
    </div>
    {preserved.length > 0 && <div className="color-evidence-status" data-testid="preserved-colors">
      <strong>{t("color.currentPreserved")}</strong>
      {preserved.map(color => <div key={color.ldrawCode}>
        <span className="preserved-color-dot" style={{ background: color.value }} />
         {displayColorName(color.name)} · LDraw {color.ldrawCode} · {result.codes === undefined ? t("color.notInPalette") : t("color.notProven")}
      </div>)}
    </div>}
    <details className="color-evidence-status"><summary>{t("color.evidenceTitle")}</summary>
      <p>{t("color.evidenceDescription", { date: manifest.snapshotDate })}</p>
      <p>{t("color.attributionPrefix")} <a href="https://rebrickable.com/downloads/" target="_blank" rel="noreferrer">Rebrickable</a> {t("color.attributionSuffix")} {t("color.license")}</p>
      <p><a href="https://rebrickable.com/downloads/" target="_blank" rel="noreferrer">{t("color.source")}</a>
        {" · "}<a href={manifest.termsUrl} target="_blank" rel="noreferrer">{t("color.terms")}</a></p>
    </details>
  </>;
}
