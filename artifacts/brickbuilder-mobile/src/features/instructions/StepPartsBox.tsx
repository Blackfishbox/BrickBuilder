import { useEffect, useMemo, useRef, useState } from "react";
import type { BuilderDocument } from "../editor/model";
import { observeThumbnail } from "../parts/thumbnails/visibility";
import { instructionPartGroups, type InstructionPart } from "./parts";
import { instructionPartImage } from "./part-images";
import { instructionCalloutImage, instructionCalloutPartIds } from "./callouts";
import type { InstructionCallout } from "./types";
import { useI18n } from "@/i18n/I18nProvider";

function PartImage({ document, entry }: { document: BuilderDocument; entry: InstructionPart }) {
  const { t } = useI18n();
  const host = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(false);
  const [result, setResult] = useState<{ source: BuilderDocument; key: string; image?: string; error?: string }>();
  useEffect(() => typeof IntersectionObserver !== "undefined" && host.current ? observeThumbnail(host.current, setVisible) : undefined, []);
  useEffect(() => {
    if (!visible) return;
    const controller = new AbortController();
    void instructionPartImage(document, entry, controller.signal).then(
      image => { if (!controller.signal.aborted) setResult({ source: document, key: entry.key, image }); },
       error => { if (!controller.signal.aborted) setResult({ source: document, key: entry.key, error: error instanceof Error ? error.message : t("instruction.imageUnavailable") }); },
    );
    return () => controller.abort();
  }, [document, entry.key, visible]);
  const current = result?.source === document && result.key === entry.key ? result : undefined;
  return <span ref={host} className="ins-part-image">
    {!visible && typeof IntersectionObserver === "undefined" ? <button onClick={() => setVisible(true)}
       aria-label={t("instruction.loadPreviewFor", { id: entry.number })}>{t("instruction.loadPreview")}</button>
      : current?.image ? <img src={current.image} alt={`${entry.number} · ${entry.colorName}`} />
      : <span role="img" aria-label={current?.error ?? t("instruction.previewLoading")} title={current?.error}>
        {current?.error ? t("instruction.previewMissing") : t("instruction.loading")}
      </span>}
  </span>;
}

function CalloutCard({ document, callout, paused }: {
  document: BuilderDocument; callout: InstructionCallout; paused: boolean;
}) {
  const { t } = useI18n();
  const host = useRef<HTMLElement>(null);
  const [visible, setVisible] = useState(false);
  const [result, setResult] = useState<{ source: BuilderDocument; key: string; image?: string; error?: string }>();
  const key = `${callout.id}:${callout.occurrence.join("/")}`;
  const ids = useMemo(() => instructionCalloutPartIds(document, callout), [document, key]);
  const missing = document.imported?.instances.filter(part => ids.includes(part.id) && part.part.status !== "resolved").length ?? 0;
  useEffect(() => typeof IntersectionObserver !== "undefined" && host.current
    ? observeThumbnail(host.current, setVisible) : undefined, []);
  useEffect(() => {
    if (!visible || paused) return;
    const controller = new AbortController();
    void instructionCalloutImage(document, callout, controller.signal).then(
      image => { if (!controller.signal.aborted) setResult({ source: document, key, image }); },
       error => { if (!controller.signal.aborted) setResult({ source: document, key, error: error instanceof Error ? error.message : t("instruction.imageUnavailable") }); },
    );
    return () => controller.abort();
  }, [document, key, visible, paused]);
  const current = result?.source === document && result.key === key ? result : undefined;
  return <article ref={host} className="ins-callout" aria-label={`${t("instruction.insertAssembly")}: ${callout.title}`}>
    <strong>{t("instruction.insertAssembly")}</strong>
    <span className="ins-callout-title" title={callout.title}>{callout.title}</span>
    <div className="ins-callout-image">
      {current?.image
        ? <img src={current.image} alt={t("instruction.assemblyPreview", { title: callout.title })} />
        : !visible && typeof IntersectionObserver === "undefined"
          ? <button onClick={() => setVisible(true)} aria-label={t("instruction.loadAssemblyPreview", { title: callout.title })}>{t("instruction.loadPreview")}</button>
          : <span role="img" aria-label={current?.error ?? t("instruction.assemblyPreviewLoading")} title={current?.error}>
            {current?.error ? t("instruction.previewMissing") : t("instruction.loading")}
          </span>}
    </div>
    <small>{t("instruction.containedParts", { count: ids.length })}{missing ? ` · ${t("instruction.withoutGeometry", { count: missing })}` : ""}</small>
  </article>;
}

export default function StepPartsBox({ document, partIds, callouts = [], paused = false }: {
  document: BuilderDocument; partIds: string[]; callouts?: InstructionCallout[]; paused?: boolean;
}) {
  const { t } = useI18n();
  const groups = useMemo(() => instructionPartGroups(document, partIds), [document, partIds]);
  return <section className="ins-parts-box" aria-label={t("instruction.partsForStep")} data-testid="instructions-parts-box">
    <header><strong>{callouts.length ? t("instruction.partsAndAssemblies") : t("instruction.partsForStep")}</strong>
      <span>{t("instruction.partsCount", { count: groups.reduce((sum, entry) => sum + entry.count, 0) })}{callouts.length ? ` · ${t("instruction.assembliesCount", { count: callouts.length })}` : ""}</span></header>
    {callouts.length > 0 && <div className="ins-callouts">
      {callouts.map(callout => <CalloutCard key={`${callout.id}:${callout.occurrence.join("/")}`}
        document={document} callout={callout} paused={paused} />)}
    </div>}
    {groups.length ? <ul>
      {groups.map(entry => <li key={entry.key} aria-label={`${entry.count} × ${entry.number} · ${entry.colorName}`}>
        <b className="ins-part-count">{entry.count}×</b>
        {!paused && <PartImage document={document} entry={entry} />}
        <span className="ins-part-number" title={entry.number}>{entry.number}</span>
        <span className="ins-part-color" title={entry.colorName}><i style={{ backgroundColor: entry.colorHex }} />{entry.colorName}</span>
      </li>)}
    </ul> : !callouts.length && <p>{t("instruction.noNewParts")}</p>}
  </section>;
}
