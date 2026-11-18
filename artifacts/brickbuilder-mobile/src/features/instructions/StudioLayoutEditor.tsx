import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, ImageOff, RotateCcw, Undo2 } from "lucide-react";
import { readZip } from "@/features/formats/zip";
import { editStudioLayout, inspectStudioLayout, type StudioLayoutField, type StudioLayoutItem } from "./studio-layout";
import type { StudioLayout } from "./types";
import "./studio-layout.css";

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
const hint: Record<StudioLayoutField["kind"], string> = {
  boolean: "", number: "Eine Zahl, z. B. 12.5",
  vector2: "Zwei Zahlen mit Leerzeichen, z. B. 10 20",
  vector4: "Vier Zahlen mit Leerzeichen, z. B. 0 0 120 80",
  color: "R:G:B:A, je 0 bis 1, z. B. 1:0.5:0:1",
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
  const value = item.attributes[field.attribute] ?? "";
  const [draft, setDraft] = useState(value);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { setDraft(value); setError(null); }, [value]);
  const edited = layout.edits.some(e => e.nodeId === item.nodeId && e.attribute === field.attribute);
  const id = `sle-${item.nodeId}-${field.attribute}`;
  const tid = `${item.nodeId}-${field.attribute.toLowerCase()}`;
  const formatHint = field.attribute === "opacity" ? "Eine Zahl zwischen 0 und 1." : hint[field.kind];

  const apply = (next: string) => {
    if (next === value) { setError(null); return; }
    try { onChange(editStudioLayout(layout, item.nodeId, field.attribute, next)); setError(null); }
    catch { setError(`Ungültiger Wert. ${formatHint}`.trim()); }
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
          <span>{field.label}</span>
        </label>
        {edited && <button className="ins-ghost sle-reset" onClick={reset} aria-label={`${field.label} zurücksetzen`} data-testid={`button-studio-layout-reset-${tid}`}><RotateCcw size={14} /></button>}
      </div>
    );
  }
  return (
    <div className={`sle-field${edited ? " is-edited" : ""}`}>
      <label htmlFor={id}>{field.label}</label>
      <div className="sle-inputrow">
        {field.kind === "color" && <i className="sle-swatch" style={{ background: colorCss(value) }} aria-hidden="true" />}
        <input id={id} type="text" inputMode={field.kind === "number" ? "decimal" : "text"} autoComplete="off" spellCheck={false}
          value={draft} aria-invalid={!!error} aria-describedby={error ? `${id}-err` : undefined}
          onChange={e => setDraft(e.target.value)} onBlur={() => apply(draft)}
          onKeyDown={e => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") { setDraft(value); setError(null); } }}
          data-testid={`input-studio-layout-${tid}`} />
        {edited && <button className="ins-ghost sle-reset" onClick={reset} aria-label={`${field.label} zurücksetzen`} data-testid={`button-studio-layout-reset-${tid}`}><RotateCcw size={14} /></button>}
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

const itemName = (item: StudioLayoutItem) => ({ Page: "Seite", Step: "Schritt-Slot", Image: "Bild", Colors: "Callout-Farben", ArrowStyle: "Callout-Pfeil", Divider: "Callout-Trennlinie", Padding: "Callout-Innenabstand", Margin: "Callout-Abstand" } as Record<string, string>)[item.label] ?? item.label;

export default function StudioLayoutEditor({ layout, originalBytes, onChange }: Props) {
  const { view, error } = useMemo(() => {
    try { return { view: inspectStudioLayout(layout), error: null }; }
    catch (e) { return { view: null, error: e instanceof Error ? e.message : "Studio-Layout konnte nicht gelesen werden." }; }
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
    <section className="ins-card sle-root" aria-label="Studio-Seitenlayout bearbeiten" data-testid="panel-studio-layout">
      <header className="sle-head">
        <div>
          <small>Studio-Seitenlayout</small>
          <strong data-testid="text-studio-layout-summary">{pages.length} Seiten · {layout.edits.length} Änderungen</strong>
        </div>
        <button className="ins-ghost" onClick={undo} disabled={!history.length} aria-label="Letzte Layoutänderung rückgängig" data-testid="button-studio-layout-undo"><Undo2 size={15} /></button>
        <button className="ins-ghost" onClick={resetAll} disabled={!layout.edits.length} data-testid="button-studio-layout-reset-all">Alle zurücksetzen</button>
      </header>
      <p className="ins-hint" data-testid="text-studio-layout-explainer">
        Hier änderst du einzelne Attribute der originalen Studio-Seiten. Das ist keine vollständige Seitendarstellung; Vorlagen, unbekannte Inhalte und eigene Layouts bleiben unverändert erhalten. Neue Callouts, Pfeile oder Seiten lassen sich nicht anlegen. Das PDF bleibt eine einfache Schrittausgabe. Die Werte sind Studio-Rohwerte; ob Studio sie genau so darstellt, ist nicht geprüft.
      </p>

      {pages.length === 0 ? (
        <p className="ins-hint" data-testid="text-studio-layout-no-pages">Keine bearbeitbaren Seiten in den Studio-Daten gefunden.</p>
      ) : (
        <>
          <div className="sle-pager">
            <button className="ins-icon" onClick={() => setPageIndex(current - 1)} disabled={current === 0} aria-label="Vorherige Seite" data-testid="button-studio-layout-prev-page"><ChevronLeft size={18} /></button>
            <label className="sle-pagejump">
              <span className="sr-only">Seitennummer</span>
              <select value={current} onChange={e => setPageIndex(Number(e.target.value))} data-testid="select-studio-layout-page">
                {pages.map((p, i) => <option key={p.nodeId} value={i}>Seite {i + 1}{p.steps.length ? ` · Schritt ${p.steps.join(", ")}` : ""}</option>)}
              </select>
            </label>
            <button className="ins-icon" onClick={() => setPageIndex(current + 1)} disabled={current === pages.length - 1} aria-label="Nächste Seite" data-testid="button-studio-layout-next-page"><ChevronRight size={18} /></button>
          </div>
          <dl className="sle-meta" data-testid={`card-studio-layout-page-${page.nodeId}`}>
            <div><dt>Vorlage</dt><dd data-testid="text-studio-layout-template">{page.template}</dd></div>
            <div><dt>Schritte (Studio-Nummern)</dt><dd data-testid="text-studio-layout-steps">{page.steps.length ? page.steps.join(", ") : "keine"}</dd></div>
          </dl>
          {images.status === "error" && <p className="sle-status" role="status" data-testid="status-studio-layout-images"><ImageOff size={14} /> Bilder nicht verfügbar: {images.message}</p>}
          {images.status === "ready" && images.skipped > 0 && <p className="sle-status" role="status" data-testid="status-studio-layout-images">{images.skipped} Bilder fehlen oder sind kein PNG/JPEG.</p>}

          <ul className="sle-items">
            {page.items.map(item => (
              <li key={item.nodeId} className="sle-item" data-testid={`item-studio-layout-${item.nodeId}`}>
                <div className="sle-itemhead">
                  {item.imagePath !== undefined && (
                    images.status === "ready" && images.urls[item.imagePath]
                      ? <img src={images.urls[item.imagePath]} alt={`Studio-Bild ${item.imagePath}`} data-testid={`img-studio-layout-${item.nodeId}`} />
                      : <span className="sle-noimg" aria-label="Kein Bild verfügbar"><ImageOff size={16} /></span>
                  )}
                  <b>{itemName(item)}</b>
                  {item.imagePath && <small>{item.imagePath}</small>}
                  {item.label === "Step" && item.attributes.SerializedIndex && <small>Schritt {item.attributes.SerializedIndex}</small>}
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
            Globale Callout-Stile ({view.calloutStyles.length}) {showStyles ? "ausblenden" : "anzeigen"}
          </button>
          {showStyles && (
            <ul className="sle-items">
              {view.calloutStyles.map(item => (
                <li key={item.nodeId} className="sle-item" data-testid={`item-studio-layout-style-${item.nodeId}`}>
                  <div className="sle-itemhead"><b>{itemName(item)}</b></div>
                  {item.fields.map(field => <FieldEditor key={fieldKey(item.nodeId, field.attribute)} item={item} field={field} layout={layout} onChange={change} />)}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {view.unsupportedCount > 0 && (
        <p className="ins-hint" data-testid="text-studio-layout-unsupported">{view.unsupportedCount} platzierte Callouts, Pfeile oder Inhalte bleiben unverändert erhalten und sind hier nicht bearbeitbar.</p>
      )}
    </section>
  );
}
