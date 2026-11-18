import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, FileDown, Info, LoaderCircle, Plus, Trash2, X } from "lucide-react";
import { BRICK_DEFINITIONS, type BuilderDocument } from "@/features/editor/model";
import BuilderCanvas from "@/features/engine/BuilderCanvas";
import { effectiveInstructions, instructionView } from "./model";
import type { InstructionPlan, InstructionStep } from "./types";
import StudioLayoutEditor from "./StudioLayoutEditor";
import "./instructions.css";

interface Props {
  document: BuilderDocument;
  onChange: (plan: InstructionPlan) => void;
  onClose: () => void;
  onExportPDF: (plan: InstructionPlan, onProgress: (done: number, total: number) => void, signal: AbortSignal) => Promise<void>;
}

interface PartInfo { id: string; label: string; color: string }

const PAGE = 60;
const STEP_WINDOW = 30;
const noop = () => undefined;

export default function InstructionsPanel({ document, onChange, onClose, onExportPDF }: Props) {
  const plan = useMemo(() => effectiveInstructions(document), [document]);
  const [index, setIndex] = useState(0);
  const current = Math.min(index, plan.steps.length - 1);
  const step = plan.steps[current];
  const [scope, setScope] = useState<"step" | "all">("step");
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(PAGE);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [exporting, setExporting] = useState<{ done: number; total: number } | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  useEffect(() => () => abortRef.current?.abort(), []);

  // Lookup tables are built once per document, not per render of each row.
  const parts = useMemo(() => {
    const map = new Map<string, PartInfo>();
    for (const b of document.bricks) map.set(b.id, { id: b.id, label: BRICK_DEFINITIONS[b.type]?.label ?? b.type, color: b.color });
    for (const p of document.imported?.instances ?? []) map.set(p.id, { id: p.id, label: p.part.name ?? p.reference, color: p.color?.hex ?? "#c8c3b4" });
    return map;
  }, [document]);
  const stepOf = useMemo(() => {
    const map = new Map<string, number>();
    plan.steps.forEach((s, i) => s.partIds.forEach(id => map.set(id, i)));
    return map;
  }, [plan]);
  const view = useMemo(() => instructionView(document, plan, current), [document, plan, current]);

  const listed = useMemo(() => {
    const source = scope === "step" ? step.partIds : [...parts.keys()];
    const q = query.trim().toLowerCase();
    return q ? source.filter(id => (parts.get(id)?.label ?? id).toLowerCase().includes(q) || id.toLowerCase().includes(q)) : source;
  }, [scope, step, parts, query]);

  const commit = (steps: InstructionStep[]) => onChange({ ...plan, edited: true, steps });
  const patchStep = (patch: Partial<InstructionStep>) => commit(plan.steps.map((s, i) => (i === current ? { ...s, ...patch } : s)));

  const go = (i: number) => { setIndex(Math.max(0, Math.min(plan.steps.length - 1, i))); setConfirmDelete(false); setLimit(PAGE); };

  const addStep = () => {
    const steps = [...plan.steps];
    steps.splice(current + 1, 0, { id: crypto.randomUUID(), title: `Schritt ${current + 2}`, notes: "", partIds: [] });
    commit(steps); go(current + 1); setIndex(current + 1);
  };
  const deleteStep = () => {
    if (plan.steps.length < 2) return;
    const target = current > 0 ? current - 1 : 1;
    const steps = plan.steps.map((s, i) => (i === target ? { ...s, partIds: target < current ? [...s.partIds, ...step.partIds] : [...step.partIds, ...s.partIds] } : s));
    steps.splice(current, 1);
    commit(steps); setConfirmDelete(false); setIndex(Math.max(0, current - 1));
  };
  const moveStep = (dir: -1 | 1) => {
    const to = current + dir;
    if (to < 0 || to >= plan.steps.length) return;
    const steps = [...plan.steps];
    [steps[current], steps[to]] = [steps[to], steps[current]];
    commit(steps); setIndex(to);
  };
  const assign = (ids: string[], target: number) => {
    const moving = new Set(ids);
    commit(plan.steps.map((s, i) => {
      const kept = s.partIds.filter(id => !moving.has(id));
      return i === target ? { ...s, partIds: [...kept, ...ids] } : { ...s, partIds: kept };
    }));
    setSelected(new Set());
  };
  const toggle = (id: string) => setSelected(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const rotation = step.rotation ?? [0, 0, 0];
  const setRotation = (axis: number, raw: string) => {
    const value = Number(raw.replace(",", "."));
    if (!Number.isFinite(value)) return;
    const next = [...rotation] as [number, number, number];
    next[axis] = value;
    patchStep({ rotation: next });
  };

  const exportPdf = async () => {
    const controller = new AbortController();
    abortRef.current = controller;
    setExportError(null);
    setExporting({ done: 0, total: plan.steps.length });
    try {
      // Release the interactive preview before allocating the PDF renderer.
      await new Promise(resolve => setTimeout(resolve, 0));
      controller.signal.throwIfAborted();
      await onExportPDF(plan, (done, total) => setExporting({ done, total }), controller.signal);
    } catch (error) {
      if (!controller.signal.aborted) setExportError(error instanceof Error ? error.message : "PDF-Export fehlgeschlagen.");
    } finally {
      abortRef.current = null;
      setExporting(null);
    }
  };

  const total = parts.size;
  const from = Math.max(0, Math.min(current - STEP_WINDOW / 2, plan.steps.length - STEP_WINDOW));
  const stepWindow = plan.steps.slice(from, from + STEP_WINDOW);

  return (
    <div className="ins-shell" role="dialog" aria-modal="true" aria-label="Bauanleitung bearbeiten" data-testid="panel-instructions">
      <header className="ins-head">
        <div className="ins-head-title">
          <small>Bauanleitung</small>
          <strong data-testid="text-instructions-summary">{plan.steps.length} Schritte · {total} Teile</strong>
        </div>
        <button className="ins-primary" onClick={exportPdf} disabled={!!exporting || total === 0} aria-label="Anleitung als PDF exportieren" data-testid="button-instructions-export-pdf">
          <FileDown size={16} /> PDF
        </button>
        <button className="ins-icon" onClick={onClose} aria-label="Anleitung schließen" data-testid="button-instructions-close"><X size={18} /></button>
      </header>

      {exporting && (
        <div className="ins-banner" role="status" data-testid="status-instructions-export">
          <LoaderCircle size={15} className="spin" />
          <span>PDF wird erstellt: {exporting.done} / {exporting.total}</span>
          <div className="ins-bar"><i style={{ transform: `scaleX(${exporting.total ? exporting.done / exporting.total : 0})` }} /></div>
          <button className="ins-ghost" onClick={() => abortRef.current?.abort()} data-testid="button-instructions-export-cancel">Abbrechen</button>
        </div>
      )}
      {exportError && (
        <div className="ins-banner is-error" role="alert" data-testid="status-instructions-export-error">
          <span>{exportError}</span>
          <button className="ins-ghost" onClick={exportPdf} data-testid="button-instructions-export-retry">Erneut versuchen</button>
          <button className="ins-ghost" onClick={() => setExportError(null)} aria-label="Fehlermeldung schließen" data-testid="button-instructions-export-dismiss"><X size={14} /></button>
        </div>
      )}

      <div className="ins-body">
        <section className="ins-preview" aria-label={`Vorschau bis ${step.title || `Schritt ${current + 1}`}`}>
          {exporting ? (
            <div className="ins-empty" role="status">PDF wird erzeugt. Die 3D-Vorschau wird dafür kurz pausiert.</div>
          ) : total === 0 ? (
            <div className="ins-empty" data-testid="text-instructions-empty">
              <strong>Noch keine Teile</strong>
              <span>Baue oder importiere ein Modell. Neue Teile landen automatisch im letzten Schritt.</span>
            </div>
          ) : (
            <BuilderCanvas
              viewRotation={step.rotation}
              projectId={`${document.id}-instructions`}
              bricks={view.bricks}
              imported={view.imported}
              selectedId={null}
              selectedType="brick-2x4"
              selectedColor="#d75b3f"
              toolMode="select"
              onPlace={noop}
              onSelect={noop}
              onMove={noop}
            />
          )}
          <div className="ins-stepper">
            <button className="ins-icon" onClick={() => go(current - 1)} disabled={current === 0} aria-label="Vorheriger Schritt" data-testid="button-instructions-prev"><ChevronLeft size={20} /></button>
            <label className="ins-jump">
              <span className="sr-only">Schrittnummer</span>
              <input type="number" inputMode="numeric" min={1} max={plan.steps.length} value={current + 1}
                onChange={e => { const n = Number(e.target.value); if (Number.isFinite(n) && n >= 1) go(n - 1); }}
                data-testid="input-instructions-step-number" />
              <span>/ {plan.steps.length}</span>
            </label>
            <button className="ins-icon" onClick={() => go(current + 1)} disabled={current === plan.steps.length - 1} aria-label="Nächster Schritt" data-testid="button-instructions-next"><ChevronRight size={20} /></button>
          </div>
        </section>

        <section className="ins-side">
          <nav className="ins-strip" aria-label="Schritte">
            {stepWindow.map((s, k) => {
              const i = from + k;
              return (
                <button key={s.id} className={i === current ? "is-active" : ""} onClick={() => go(i)} aria-current={i === current ? "step" : undefined}
                  aria-label={`${s.title || `Schritt ${i + 1}`}, ${s.partIds.length} Teile`} data-testid={`button-instructions-step-${s.id}`}>
                  <b>{i + 1}</b><small>{s.partIds.length}</small>
                </button>
              );
            })}
          </nav>

          <div className="ins-card">
            <div className="ins-row">
              <label className="ins-field ins-grow">
                <span>Titel</span>
                <input value={step.title} maxLength={160} onChange={e => patchStep({ title: e.target.value })} data-testid="input-instructions-step-title" />
              </label>
            </div>
            <label className="ins-field">
              <span>Hinweise</span>
              <textarea rows={2} value={step.notes} maxLength={2000} onChange={e => patchStep({ notes: e.target.value })} placeholder="Zum Beispiel: Achse zuerst einstecken" data-testid="input-instructions-step-notes" />
            </label>
            <fieldset className="ins-rot">
              <legend>Ansicht drehen (Grad)</legend>
              {(["X", "Y", "Z"] as const).map((axis, a) => (
                <label key={axis} className="ins-field">
                  <span>{axis}</span>
                  <input key={`${step.id}-${a}-${rotation[a]}`} type="text" inputMode="decimal" defaultValue={String(rotation[a])}
                    onBlur={e => setRotation(a, e.target.value)} onKeyDown={e => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                    aria-label={`Drehung ${axis} in Grad`} data-testid={`input-instructions-rotation-${axis.toLowerCase()}`} />
                </label>
              ))}
              {step.rotation && <button className="ins-ghost" onClick={() => patchStep({ rotation: undefined })} data-testid="button-instructions-rotation-reset">Zurücksetzen</button>}
            </fieldset>
            <p className="ins-hint">Die gespeicherte Schrittdrehung wird direkt in der 3D-Ansicht und im PDF gezeigt. Zusätzlich kannst du die Ansicht per Touch bewegen. Geänderte Schritte werden beim IO-Export als flache Baugruppe mit einfachen Anleitungsseiten ausgegeben. Originale Studio-Daten bleiben als Sicherung erhalten.</p>
            <div className="ins-actions">
              <button className="ins-ghost" onClick={addStep} data-testid="button-instructions-add-step"><Plus size={15} /> Schritt danach</button>
              <button className="ins-ghost" onClick={() => moveStep(-1)} disabled={current === 0} aria-label="Schritt nach vorne verschieben" data-testid="button-instructions-move-up"><ArrowUp size={15} /></button>
              <button className="ins-ghost" onClick={() => moveStep(1)} disabled={current === plan.steps.length - 1} aria-label="Schritt nach hinten verschieben" data-testid="button-instructions-move-down"><ArrowDown size={15} /></button>
              {confirmDelete ? (
                <span className="ins-confirm">
                  <button className="ins-danger" onClick={deleteStep} data-testid="button-instructions-delete-confirm">Löschen</button>
                  <button className="ins-ghost" onClick={() => setConfirmDelete(false)} data-testid="button-instructions-delete-cancel">Nein</button>
                </span>
              ) : (
                <button className="ins-ghost is-danger" onClick={() => setConfirmDelete(true)} disabled={plan.steps.length < 2}
                  aria-label="Schritt löschen, Teile gehen an den Nachbarschritt" data-testid="button-instructions-delete-step"><Trash2 size={15} /></button>
              )}
            </div>
            {confirmDelete && <p className="ins-hint">{step.partIds.length} Teile werden in {current > 0 ? `Schritt ${current}` : "den folgenden Schritt"} verschoben.</p>}
          </div>

          <div className="ins-card ins-parts">
            <div className="ins-tabs" role="tablist">
              <button role="tab" aria-selected={scope === "step"} onClick={() => { setScope("step"); setLimit(PAGE); }} data-testid="tab-instructions-step-parts">In diesem Schritt ({step.partIds.length})</button>
              <button role="tab" aria-selected={scope === "all"} onClick={() => { setScope("all"); setLimit(PAGE); }} data-testid="tab-instructions-all-parts">Alle Teile ({total})</button>
            </div>
            <input className="ins-search" type="search" value={query} onChange={e => { setQuery(e.target.value); setLimit(PAGE); }} placeholder="Teil suchen" aria-label="Teile filtern" data-testid="input-instructions-part-search" />
            {selected.size > 0 && (
              <div className="ins-selbar" data-testid="status-instructions-selection">
                <span>{selected.size} ausgewählt</span>
                <button className="ins-primary" onClick={() => assign([...selected], current)} data-testid="button-instructions-assign-selected">Zu Schritt {current + 1}</button>
                <button className="ins-ghost" onClick={() => setSelected(new Set())} data-testid="button-instructions-clear-selection">Aufheben</button>
              </div>
            )}
            {listed.length === 0 ? (
              <p className="ins-hint" data-testid="text-instructions-no-parts">{query ? "Keine Treffer." : scope === "step" ? "Dieser Schritt hat noch keine Teile. Wechsle zu \u201eAlle Teile\u201c, um welche zuzuordnen." : "Keine Teile vorhanden."}</p>
            ) : (
              <ul className="ins-list">
                {listed.slice(0, limit).map(id => {
                  const p = parts.get(id); const owner = stepOf.get(id) ?? 0;
                  return (
                    <li key={id} className={selected.has(id) ? "is-selected" : ""}>
                      <label>
                        <input type="checkbox" checked={selected.has(id)} onChange={() => toggle(id)} aria-label={`${p?.label ?? id} auswählen`} data-testid={`checkbox-instructions-part-${id}`} />
                        <i style={{ background: p?.color }} />
                        <span><b>{p?.label ?? id}</b><small>Schritt {owner + 1}</small></span>
                      </label>
                      {owner !== current && (
                        <button className="ins-ghost" onClick={() => assign([id], current)} aria-label={`${p?.label ?? id} zu Schritt ${current + 1} verschieben`} data-testid={`button-instructions-assign-${id}`}>Hierher</button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
            {listed.length > limit && (
              <button className="ins-ghost ins-more" onClick={() => setLimit(l => l + PAGE)} data-testid="button-instructions-more-parts">Weitere {Math.min(PAGE, listed.length - limit)} von {listed.length - limit} anzeigen</button>
            )}
            {listed.length > 0 && (
              <button className="ins-ghost ins-more" onClick={() => setSelected(new Set(listed.slice(0, limit)))} data-testid="button-instructions-select-visible">Angezeigte auswählen</button>
            )}
          </div>

          {plan.studioLayout && (
            <StudioLayoutEditor layout={plan.studioLayout} originalBytes={document.imported?.originalBytes}
              onChange={next => onChange({ ...plan, studioLayout: next, edited: true })} />
          )}
          {(plan.source === "studio" || document.imported?.format === "io") && (
            <p className="ins-note" data-testid="text-instructions-studio-note"><Info size={14} /> {plan.studioLayout
              ? "Studio-Seitenlayouts lassen sich oben über einzelne Attribute anpassen (Sperre, Schrittversatz, Bilder, globale Callout-Stile). Der IO-Export lehnt es ab, Layoutänderungen mit geänderten Schritten oder Modelländerungen zu kombinieren. Speichere als JSON, um beides zu behalten."
              : "Für dieses Modell liegen keine lesbaren Studio-Seitenlayouts vor. Bearbeitet werden nur Schrittfolge, Teilezuordnung, Texte und Drehung."}</p>
          )}
          {plan.warnings.length > 0 && (
            <ul className="ins-note" data-testid="list-instructions-warnings">{plan.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
          )}
        </section>
      </div>
    </div>
  );
}
