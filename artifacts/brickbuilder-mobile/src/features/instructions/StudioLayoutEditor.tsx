import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, ImageOff, RotateCcw, Undo2 } from "lucide-react";
import { readZip } from "@/features/formats/zip";
import { editStudioLayout, inspectStudioLayout, type StudioLayoutField, type StudioLayoutItem } from "./studio-layout";
import type { StudioLayout } from "./types";
import "./studio-layout.css";
import { useI18n } from "@/i18n/I18nProvider";
import type { MessageId } from "@/i18n/messages";

interface Props { layout: StudioLayout; originalBytes?: number[]; onChange: (layout: StudioLayout) => void }

const MAX_IMAGE = 8 * 1024 * 1024;
const MAX_IMAGES = 64;

function sniff(bytes: Uint8Array): string | null {
  if (bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  return null;
}
const localPath = (p: string) => !!p && p.length < 300 && !/^[a-z][a-z0-9+.-]*:/i.test(p) && !p.startsWith("//") && !p.split(/[\\/]/).includes("..");
const fieldKey = (nodeId: number, attr: string) => `${nodeId}:${attr}`;
const hint: Record<StudioLayoutField["kind"], MessageId | ""> = {
  boolean: "", number: "studio.numberHint",
  vector2: "studio.vector2Hint",
  vector4: "studio.vector4Hint",
  color: "studio.colorHint",
  text: "",
};

type ImageState = { status: "loading" } | { status: "none" } | { status: "error"; message: string } | { status: "ready"; urls: Record<string, string>; skipped: number };

function useStudioImages(paths: string[], originalBytes?: number[]): ImageState {
  const key = paths.join("\n");
  const [state, setState] = useState<ImageState>({ status: "loading" });
  useEffect(() => {
    const wanted = key ? key.split("\n").filter(localPath).slice(0, MAX_IMAGES) : [];
    if (!wanted.length || !originalBytes?.length) { setState({ status: "none" }); return; }
    const urls: Record<string, string> = {};
    let skipped = 0;
    try {
      const entries = readZip(new Uint8Array(originalBytes), { names: wanted, studioEncryption: true });
      for (const path of wanted) {
        const bytes = entries[path];
        const type = bytes && bytes.length <= MAX_IMAGE ? sniff(bytes) : null;
        if (!bytes || !type) { skipped++; continue; }
        urls[path] = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type }));
      }
      setState({ status: "ready", urls, skipped });
    } catch (error) {
      setState({ status: "error", message: error instanceof Error ? error.message : "Bilder konnten nicht gelesen werden." });
    }
    return () => { Object.values(urls).forEach(u => URL.revokeObjectURL(u)); };
  }, [key, originalBytes]);
  return state;
}

function FieldEditor({ item, field, layout, onChange }: { item: StudioLayoutItem; field: StudioLayoutField; layout: StudioLayout; onChange: (l: StudioLayout) => void }) {
  const { t } = useI18n();
  const labels: Record<string, MessageId> = {
    IsLocked: "studio.field.pageLock", RectOffset: "studio.field.stepOffset", rect: "studio.field.imageRect",
    rotation: "studio.field.rotation", opacity: "studio.field.opacity", fliped_H: "studio.field.flipH", fliped_V: "studio.field.flipV",
    IsUseBgColor: "studio.field.useBackground", BgColor: "studio.field.background", IsUseBorder: "studio.field.useBorder",
    BorderColor: "studio.field.borderColor", BorderThickness: "studio.field.borderThickness", BorderRadius: "studio.field.cornerRadius",
    Thickness: "studio.field.arrowThickness", Color: "studio.field.arrowColor",
    IsVisible: item.label === "Divider" ? "studio.field.dividerVisible" : "studio.field.visible",
    Rect: "studio.field.calloutRect", MultiplierValue: "studio.field.multiplierValue",
    MultiplierPosition: "studio.field.multiplierPosition", CalloutGridMaxPerLine: "studio.field.calloutGrid",
    IsCalloutAsRows: "studio.field.calloutRows", ArrowPosition: "studio.field.arrowPosition",
    PointList: "studio.field.arrowPoints", StartStyle: "studio.field.arrowStart", EndStyle: "studio.field.arrowEnd",
    DividerThickness: "studio.field.lineThickness", DividerColor: "studio.field.lineColor", LRBT: "studio.field.padding",
    Horizontal: "studio.field.horizontalMargin", Vertical: "studio.field.verticalMargin",
    FontFamily: "studio.field.fontFamily", FontStyle: "studio.field.fontStyle", FontColor: "studio.field.fontColor",
    FontSize: "studio.field.fontSize", Style: "studio.field.arrowShape", SlotSpacing: "studio.field.slotSpacing",
  };
  const label = t(labels[field.attribute] ?? "studio.layoutTitle");
  const value = item.attributes[field.attribute] ?? "";
  const [draft, setDraft] = useState(value);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { setDraft(value); setError(null); }, [value]);
  const edited = layout.edits.some(e => e.nodeId === item.nodeId && e.attribute === field.attribute);
  const id = `sle-${item.nodeId}-${field.attribute}`;
  const tid = `${item.nodeId}-${field.attribute.toLowerCase()}`;
  const formatHint = field.attribute === "opacity" ? t("studio.opacityHint") : hint[field.kind] ? t(hint[field.kind] as MessageId) : "";

  const apply = (next: string) => {
    if (next === value) { setError(null); return; }
    try { onChange(editStudioLayout(layout, item.nodeId, field.attribute, next)); setError(null); }
    catch { setError(t("studio.invalidValue", { hint: formatHint })); }
  };
  const reset = () => {
    const filtered = { ...layout, edits: layout.edits.filter(e => !(e.nodeId === item.nodeId && e.attribute === field.attribute)) };
    onChange(filtered);
  };

  if (field.kind === "boolean") {
    return (
      <div className={`sle-field sle-bool${edited ? " is-edited" : ""}`}>
        <label htmlFor={id}>
          <input id={id} type="checkbox" checked={value === "True"} onChange={e => apply(e.target.checked ? "True" : "False")} data-testid={`checkbox-studio-layout-${tid}`} />
          <span>{label}</span>
        </label>
        {edited && <button className="ins-ghost sle-reset" onClick={reset} aria-label={t("studio.resetField", { name: label })} data-testid={`button-studio-layout-reset-${tid}`}><RotateCcw size={14} /></button>}
      </div>
    );
  }
  return (
    <div className={`sle-field${edited ? " is-edited" : ""}`}>
      <label htmlFor={id}>{label}</label>
      <div className="sle-inputrow">
        {field.kind === "color" && <i className="sle-swatch" style={{ background: colorCss(value) }} aria-hidden="true" />}
        <input id={id} type="text" inputMode={field.kind === "number" ? "decimal" : "text"} autoComplete="off" spellCheck={false}
          value={draft} aria-invalid={!!error} aria-describedby={error ? `${id}-err` : undefined}
          onChange={e => setDraft(e.target.value)} onBlur={() => apply(draft)}
          onKeyDown={e => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") { setDraft(value); setError(null); } }}
          data-testid={`input-studio-layout-${tid}`} />
        {edited && <button className="ins-ghost sle-reset" onClick={reset} aria-label={t("studio.resetField", { name: label })} data-testid={`button-studio-layout-reset-${tid}`}><RotateCcw size={14} /></button>}
      </div>
      {error ? <small id={`${id}-err`} className="sle-error" role="alert" data-testid={`error-studio-layout-${tid}`}>{error}</small>
        : formatHint && <small className="sle-hint">{formatHint}</small>}
    </div>
  );
}

function colorCss(v: string) {
  const n = v.split(":").map(Number);
  if (n.length !== 4 || !n.every(Number.isFinite)) return "transparent";
  return `rgba(${n.slice(0, 3).map(c => Math.round(c * 255)).join(",")},${n[3]})`;
}

function itemName(item: StudioLayoutItem, t: ReturnType<typeof useI18n>["t"]): string {
  const keys: Record<string, MessageId> = {
    Page: "studio.name.page", Step: "studio.name.step", Image: "studio.name.image", Colors: "studio.name.colors",
    ArrowStyle: "studio.name.arrow", Divider: "studio.name.divider", Padding: "studio.name.padding", Margin: "studio.name.margin",
    StepNumber: "studio.name.stepNumber", PartCount: "studio.name.partCount", PartsList: "studio.name.partsList",
    Multiplier: "studio.name.multiplier", Font: "studio.name.font", SubModelPreview: "studio.name.submodelPreview",
    Spacing: "studio.name.spacing", AssemblyMargin: "studio.name.margin",
    CallOut: "studio.name.callout", CallOutItemData: "studio.name.callout", CallOutArrowItemData: "studio.name.arrow",
    Arrow: "studio.name.arrow",
  };
  return keys[item.label] ? t(keys[item.label]) : item.label;
}

export default function StudioLayoutEditor({ layout, originalBytes, onChange }: Props) {
  const { t } = useI18n();
  const { view, error } = useMemo(() => {
    try { return { view: inspectStudioLayout(layout), error: null }; }
    catch (e) { return { view: null, error: e instanceof Error ? e.message : t("studio.layoutError") }; }
  }, [layout]);
  const [pageIndex, setPageIndex] = useState(0);
  const [history, setHistory] = useState<StudioLayout[]>([]);
  const [showStyles, setShowStyles] = useState(false);

  const pages = view?.pages ?? [];
  const current = Math.min(pageIndex, Math.max(0, pages.length - 1));
  const page = pages[current];
  const imagePaths = useMemo(() => [...new Set(pages.flatMap(p => p.items.map(i => i.imagePath).filter((p): p is string => !!p)))].sort(), [pages]);
  const images = useStudioImages(imagePaths, originalBytes);

  const change = (next: StudioLayout) => { setHistory(h => [...h.slice(-49), layout]); onChange(next); };
  const undo = () => { const prev = history.at(-1); if (!prev) return; setHistory(h => h.slice(0, -1)); onChange(prev); };
  const resetAll = () => change({ ...layout, edits: [] });

  if (error || !view) {
    return <div className="ins-banner is-error sle-root" role="alert" data-testid="status-studio-layout-error">{error}</div>;
  }

  return (
    <section className="ins-card sle-root" aria-label={t("studio.layout")} data-testid="panel-studio-layout">
      <header className="sle-head">
        <div>
          <small>{t("studio.layoutTitle")}</small>
          <strong data-testid="text-studio-layout-summary">{t("studio.pageSummary", { pages: pages.length, changes: layout.edits.length })}</strong>
        </div>
        <button className="ins-ghost" onClick={undo} disabled={!history.length} aria-label={t("studio.undo")} data-testid="button-studio-layout-undo"><Undo2 size={15} /></button>
        <button className="ins-ghost" onClick={resetAll} disabled={!layout.edits.length} data-testid="button-studio-layout-reset-all">{t("studio.resetAll")}</button>
      </header>
      <p className="ins-hint" data-testid="text-studio-layout-explainer">
        {t("studio.explainer")}
      </p>

      {pages.length === 0 ? (
        <p className="ins-hint" data-testid="text-studio-layout-no-pages">{t("studio.noPages")}</p>
      ) : (
        <>
          <div className="sle-pager">
            <button className="ins-icon" onClick={() => setPageIndex(current - 1)} disabled={current === 0} aria-label={t("studio.previousPage")} data-testid="button-studio-layout-prev-page"><ChevronLeft size={18} /></button>
            <label className="sle-pagejump">
              <span className="sr-only">{t("studio.pageNumber")}</span>
              <select value={current} onChange={e => setPageIndex(Number(e.target.value))} data-testid="select-studio-layout-page">
                {pages.map((p, i) => <option key={p.nodeId} value={i}>{t("studio.page", { page: i + 1 })}{p.steps.length ? ` · ${t("studio.stepNumber", { number: p.steps.join(", ") })}` : ""}</option>)}
              </select>
            </label>
            <button className="ins-icon" onClick={() => setPageIndex(current + 1)} disabled={current === pages.length - 1} aria-label={t("instruction.next")} data-testid="button-studio-layout-next-page"><ChevronRight size={18} /></button>
          </div>
          <dl className="sle-meta" data-testid={`card-studio-layout-page-${page.nodeId}`}>
            <div><dt>{t("studio.template")}</dt><dd data-testid="text-studio-layout-template">{page.template}</dd></div>
            <div><dt>{t("studio.stepsStudio")}</dt><dd data-testid="text-studio-layout-steps">{page.steps.length ? page.steps.join(", ") : t("studio.none")}</dd></div>
          </dl>
          {images.status === "error" && <p className="sle-status" role="status" data-testid="status-studio-layout-images"><ImageOff size={14} /> {t("studio.imagesUnavailable", { reason: images.message })}</p>}
          {images.status === "ready" && images.skipped > 0 && <p className="sle-status" role="status" data-testid="status-studio-layout-images">{t("studio.imagesMissing", { count: images.skipped })}</p>}

          <ul className="sle-items">
            {page.items.map(item => (
              <li key={item.nodeId} className="sle-item" data-testid={`item-studio-layout-${item.nodeId}`}>
                <div className="sle-itemhead">
                  {item.imagePath !== undefined && (
                    images.status === "ready" && images.urls[item.imagePath]
                       ? <img src={images.urls[item.imagePath]} alt={t("studio.image", { path: item.imagePath })} data-testid={`img-studio-layout-${item.nodeId}`} />
                       : <span className="sle-noimg" aria-label={t("studio.noImage")}><ImageOff size={16} /></span>
                  )}
                   <b>{itemName(item, t)}</b>
                  {item.imagePath && <small>{item.imagePath}</small>}
                   {item.label === "Step" && item.attributes.SerializedIndex && <small>{t("studio.stepNumber", { number: item.attributes.SerializedIndex })}</small>}
                </div>
                {item.fields.map(field => <FieldEditor key={fieldKey(item.nodeId, field.attribute)} item={item} field={field} layout={layout} onChange={change} />)}
              </li>
            ))}
          </ul>
        </>
      )}

      {view.calloutStyles.length > 0 && (
        <div className="sle-styles">
          <button className="ins-ghost ins-more" onClick={() => setShowStyles(s => !s)} aria-expanded={showStyles} data-testid="button-studio-layout-toggle-styles">
            {t("studio.globalStyles", { count: view.calloutStyles.length })} {showStyles ? t("studio.hide") : t("studio.show")}
          </button>
          {showStyles && (
            <ul className="sle-items">
              {view.calloutStyles.map(item => (
                <li key={item.nodeId} className="sle-item" data-testid={`item-studio-layout-style-${item.nodeId}`}>
                   <div className="sle-itemhead"><b>{itemName(item, t)}</b></div>
                  {item.fields.map(field => <FieldEditor key={fieldKey(item.nodeId, field.attribute)} item={item} field={field} layout={layout} onChange={change} />)}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {view.unsupportedDetails.length > 0 && (
        <p className="ins-hint" data-testid="text-studio-layout-unsupported">
          {t("studio.unsupportedDetails", { details: view.unsupportedDetails.map(detail => {
            const element = /^(CallOut|Arrow|ContentItem|BrickBuilderNotes|SizeGuide|ColorGuide) × (\d+)$/.exec(detail);
            if (element) {
              const key = ({
                CallOut: "studio.unsupported.callouts", Arrow: "studio.unsupported.arrows",
                ContentItem: "studio.unsupported.content", BrickBuilderNotes: "studio.unsupported.notes",
                SizeGuide: "studio.unsupported.sizeGuide", ColorGuide: "studio.unsupported.colorGuide",
              } as const)[element[1] as "CallOut" | "Arrow" | "ContentItem" | "BrickBuilderNotes" | "SizeGuide" | "ColorGuide"];
              return t(key, { count: Number(element[2]) });
            }
            if (detail.startsWith("Template: ")) return t("studio.unsupported.template", { name: detail.slice(10) });
            if (detail.startsWith("Font: ")) return t("studio.unsupported.font", { name: detail.slice(6) });
            if (detail.startsWith("Font style: ")) return t("studio.unsupported.fontStyle", { name: detail.slice(12) });
            return detail;
          }).join(", ") })}
        </p>
      )}
    </section>
  );
}
