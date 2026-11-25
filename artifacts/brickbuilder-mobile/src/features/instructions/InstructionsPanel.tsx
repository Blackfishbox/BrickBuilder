import { useEffect, useMemo, useRef, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, FileDown, Info, LoaderCircle, Plus, Sparkles, Trash2, X } from "lucide-react";
import { BRICK_DEFINITIONS, type BuilderDocument } from "@/features/editor/model";
import BuilderCanvas from "@/features/engine/BuilderCanvas";
import { effectiveInstructions, instructionView } from "./model";
import type { InstructionPlan, InstructionStep } from "./types";
import {
  DEFAULT_INSTRUCTION_PHI,
  DEFAULT_INSTRUCTION_THETA,
  instructionRotationFromCameraPose,
} from "../engine/instruction-camera";
import StudioLayoutEditor from "./StudioLayoutEditor";
import StepPartsBox from "./StepPartsBox";
import { instructionHighlightIds } from "./callouts";
import { hasStudioPdfLayout } from "./studio-pdf";
import { generateAutomaticInstructionSteps, type AutoInstructionProgress } from "./auto-generate";
import "./instructions.css";
import { useI18n } from "@/i18n/I18nProvider";

interface Props {
  document: BuilderDocument;
  darkMode?: boolean;
  onChange: (plan: InstructionPlan) => void;
  onClose: () => void;
  onExportPDF: (plan: InstructionPlan, onProgress: (done: number, total: number) => void, signal: AbortSignal, highlight: boolean) => Promise<void>;
  onExportStudioPDF?: (plan: InstructionPlan, onProgress: (done: number, total: number) => void, signal: AbortSignal, highlight: boolean) => Promise<void>;
  onRetryExport?: () => Promise<boolean>;
}

interface PartInfo { id: string; label: string; color: string }

const PAGE = 60;
const STEP_WINDOW = 30;
const noop = () => undefined;

export default function InstructionsPanel({ document, darkMode = false, onChange, onClose, onExportPDF, onExportStudioPDF, onRetryExport }: Props) {
  const { t } = useI18n();
  const plan = useMemo(() => {
    const source = effectiveInstructions(document);
    return {
      ...source,
      steps: source.steps.map((step, index) => {
        const number = index + 1;
        const defaultTitle = step.title === "" ||
          step.title === `Schritt ${number}` || step.title === `Step ${number}`;
        return defaultTitle ? { ...step, title: t("instruction.stepNumber", { number }) } : step;
      }),
    };
  }, [document, t]);
  const planRef = useRef(plan);
  planRef.current = plan;
  const [index, setIndex] = useState(0);
  const [highlight, setHighlight] = useState(false);
  const current = Math.min(index, plan.steps.length - 1);
  const step = plan.steps[current];
  const focusIds = useMemo(() => highlight && current > 0 ? instructionHighlightIds(document, step) : undefined, [highlight, current, document, step]);
  const [scope, setScope] = useState<"step" | "all">("step");
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(PAGE);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmDeleteAll, setConfirmDeleteAll] = useState(false);
  const [exporting, setExporting] = useState<{ done: number; total: number } | null>(null);
  const [autoProgress, setAutoProgress] = useState<AutoInstructionProgress | null>(null);
  const [showAutoConfirm, setShowAutoConfirm] = useState(false);
  const [autoError, setAutoError] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [retryStudioExport, setRetryStudioExport] = useState(false);
  const [retryingShare, setRetryingShare] = useState(false);
  const [angleDrafts, setAngleDrafts] = useState<Record<string, string>>({});
  const angleDraftRef = useRef<{ stepId: string; axis: number; value: string } | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const autoAbortRef = useRef<AbortController | null>(null);
  useEffect(() => () => {
    abortRef.current?.abort();
    autoAbortRef.current?.abort();
  }, []);

  // Lookup tables are built once per document, not per render of each row.
  const parts = useMemo(() => {
    const map = new Map<string, PartInfo>();
    for (const b of document.bricks) {
      const builtin = b.type === "brick-2x4" ? "brick.classic" : b.type === "brick-2x2" ? "brick.square" : b.type === "brick-1x2" ? "brick.narrow" : undefined;
      map.set(b.id, { id: b.id, label: builtin ? t(builtin) : BRICK_DEFINITIONS[b.type]?.label ?? b.type, color: b.color });
    }
    for (const p of document.imported?.instances ?? []) map.set(p.id, { id: p.id, label: p.part.name ?? p.reference, color: p.color?.hex ?? "#c8c3b4" });
    return map;
  }, [document, t]);
  const stepOf = useMemo(() => {
    const map = new Map<string, number>();
    plan.steps.forEach((s, i) => s.partIds.forEach(id => map.set(id, i)));
    return map;
  }, [plan]);
  const view = useMemo(() => instructionView(document, plan, current), [document, plan, current]);
  const studioPdfAvailable = useMemo(
    () => Boolean(onExportStudioPDF && hasStudioPdfLayout(document, plan)),
    [document.imported?.format, plan.studioLayout, onExportStudioPDF],
  );

  const listed = useMemo(() => {
    const source = scope === "step" ? step.partIds : [...parts.keys()];
    const q = query.trim().toLowerCase();
    return q ? source.filter(id => (parts.get(id)?.label ?? id).toLowerCase().includes(q) || id.toLowerCase().includes(q)) : source;
  }, [scope, step, parts, query]);

  const commit = (steps: InstructionStep[]) => onChange({ ...plan, edited: true, steps });
  const patchStep = (patch: Partial<InstructionStep>) => commit(plan.steps.map((s, i) => (i === current ? { ...s, ...patch } : s)));

  const angleDraftKey = (stepId: string, axis: number) => `${stepId}:${axis}`;
  const clearAngleDraft = (stepId: string, axis: number) => {
    if (angleDraftRef.current?.stepId === stepId && angleDraftRef.current.axis === axis) angleDraftRef.current = null;
    const key = angleDraftKey(stepId, axis);
    setAngleDrafts(previous => {
      if (!(key in previous)) return previous;
      const next = { ...previous };
      delete next[key];
      return next;
    });
  };
  const clearStepAngleDrafts = (stepId: string) => {
    if (angleDraftRef.current?.stepId === stepId) angleDraftRef.current = null;
    const prefix = `${stepId}:`;
    setAngleDrafts(previous => {
      if (!Object.keys(previous).some(key => key.startsWith(prefix))) return previous;
      return Object.fromEntries(Object.entries(previous).filter(([key]) => !key.startsWith(prefix)));
    });
  };
  const withRotationEdit = (steps: InstructionStep[], stepId: string, axis: number, raw: string) => {
    const value = Number(raw.replace(",", "."));
    const target = steps.find(candidate => candidate.id === stepId);
    if (!target || !Number.isFinite(value)) return steps;
    const targetRotation = instructionRotationFromCameraPose(
      target.camera?.theta ?? DEFAULT_INSTRUCTION_THETA,
      target.camera?.phi ?? DEFAULT_INSTRUCTION_PHI,
      target.rotation,
    );
    const next = [...targetRotation] as [number, number, number];
    next[axis] = value;
    const camera = target.camera ? {
      ...target.camera,
      theta: DEFAULT_INSTRUCTION_THETA,
      phi: DEFAULT_INSTRUCTION_PHI,
    } : undefined;
    return steps.map(candidate => candidate.id === stepId
      ? { ...candidate, rotation: next, camera }
      : candidate);
  };
  const saveAngleDraft = (steps: InstructionStep[]) => {
    const pending = angleDraftRef.current;
    if (!pending) return steps;
    clearAngleDraft(pending.stepId, pending.axis);
    return withRotationEdit(steps, pending.stepId, pending.axis, pending.value);
  };
  const commitAngleField = (stepId: string, axis: number, raw: string) => {
    const pending = angleDraftRef.current;
    if (pending?.stepId !== stepId || pending.axis !== axis) return;
    clearAngleDraft(stepId, axis);
    const latestPlan = planRef.current;
    const updated = withRotationEdit(latestPlan.steps, stepId, axis, raw);
    if (updated !== latestPlan.steps) onChange({ ...latestPlan, edited: true, steps: updated });
  };

  const go = (i: number) => {
    const steps = saveAngleDraft(plan.steps);
    if (steps !== plan.steps) commit(steps);
    setIndex(Math.max(0, Math.min(plan.steps.length - 1, i)));
    setConfirmDelete(false);
    setLimit(PAGE);
  };

  const addStep = () => {
    const steps = [...saveAngleDraft(plan.steps)];
    steps.splice(current + 1, 0, { id: crypto.randomUUID(), title: t("instruction.stepNumber", { number: current + 2 }), notes: "", partIds: [] });
    commit(steps);
    setIndex(current + 1);
    setConfirmDelete(false);
    setLimit(PAGE);
  };
  const deleteStep = () => {
    if (plan.steps.length < 2) return;
    const target = current > 0 ? current - 1 : 1;
    const steps = saveAngleDraft(plan.steps).map((s, i) => (i === target ? { ...s, partIds: target < current ? [...s.partIds, ...step.partIds] : [...step.partIds, ...s.partIds] } : s));
    steps.splice(current, 1);
    commit(steps); setConfirmDelete(false); setIndex(Math.max(0, current - 1));
  };
  const deleteAllSteps = () => {
    const layoutWarning = t("instruction.deleteAllStepsLayoutRemoved");
    onChange({
      ...plan,
      source: "manual",
      edited: true,
      steps: [{
        id: crypto.randomUUID(),
        title: t("instruction.stepNumber", { number: 1 }),
        notes: "",
        partIds: [],
      }],
      warnings: plan.studioLayout && !plan.warnings.includes(layoutWarning)
        ? [...plan.warnings, layoutWarning].slice(-100)
        : plan.warnings,
      studioLayout: undefined,
    });
    setIndex(0);
    setSelected(new Set());
    setScope("all");
    setLimit(PAGE);
    setConfirmDelete(false);
    setConfirmDeleteAll(false);
    setShowAutoConfirm(false);
  };
  const moveStep = (dir: -1 | 1) => {
    const to = current + dir;
    if (to < 0 || to >= plan.steps.length) return;
    const steps = [...saveAngleDraft(plan.steps)];
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
  const generateSteps = async () => {
    setShowAutoConfirm(false);
    setAutoError(null);
    const controller = new AbortController();
    autoAbortRef.current = controller;
    setAutoProgress({ completed: 0, total: parts.size });
    try {
      await new Promise(resolve => setTimeout(resolve, 0));
      const result = await generateAutomaticInstructionSteps(document, controller.signal, setAutoProgress);
      controller.signal.throwIfAborted();
      const warnings = [
        t("instruction.autoSequenceHeuristic"),
        ...(result.unconnectedPartIds.length && parts.size > 1
          ? [t("instruction.autoUnconnected", { count: result.unconnectedPartIds.length })] : []),
        ...(result.missingGeometryPartIds.length
          ? [t("instruction.autoMissingGeometry", { count: result.missingGeometryPartIds.length })] : []),
        ...(result.fallbackPartIds.length
          ? [t("instruction.autoFallback", { count: result.fallbackPartIds.length })] : []),
        ...(plan.studioLayout
          ? [t("instruction.autoStudioLayoutReplaced")] : []),
      ];
      onChange({
        ...plan,
        source: "manual",
        edited: true,
        steps: result.steps.map((generated, index) => ({
          ...generated,
          title: t("instruction.stepNumber", { number: index + 1 }),
        })),
        warnings,
        studioLayout: undefined,
      });
      setIndex(0);
      setSelected(new Set());
      setScope("step");
      setLimit(PAGE);
    } catch (error) {
      if (!controller.signal.aborted) {
        setAutoError(error instanceof Error ? error.message : t("instruction.autoGenerateFailed"));
      }
    } finally {
      autoAbortRef.current = null;
      setAutoProgress(null);
    }
  };
  const toggle = (id: string) => setSelected(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const rotation = useMemo(() => instructionRotationFromCameraPose(
    step.camera?.theta ?? DEFAULT_INSTRUCTION_THETA,
    step.camera?.phi ?? DEFAULT_INSTRUCTION_PHI,
    step.rotation,
  ), [step.camera?.theta, step.camera?.phi, step.rotation]);
  const setRotationDraft = (stepId: string, axis: number, value: string) => {
    angleDraftRef.current = { stepId, axis, value };
    setAngleDrafts(previous => ({ ...previous, [angleDraftKey(stepId, axis)]: value }));
  };
  const resetRotation = () => {
    clearStepAngleDrafts(step.id);
    patchStep({
      rotation: undefined,
      camera: step.camera ? { ...step.camera, theta: DEFAULT_INSTRUCTION_THETA, phi: DEFAULT_INSTRUCTION_PHI } : undefined,
    });
  };

  const exportPdf = async (studioLayout = false) => {
    setRetryStudioExport(studioLayout);
    const latestPlan = planRef.current;
    const steps = saveAngleDraft(latestPlan.steps);
    const exportPlan = steps === latestPlan.steps
      ? latestPlan
      : { ...latestPlan, edited: true, steps };
    if (exportPlan !== latestPlan) onChange(exportPlan);

    const controller = new AbortController();
    abortRef.current = controller;
    setExportError(null);
    setExporting({ done: 0, total: exportPlan.steps.length });
    try {
      // Release the interactive preview before allocating the PDF renderer.
      await new Promise(resolve => setTimeout(resolve, 0));
      controller.signal.throwIfAborted();
      const exportHandler = studioLayout ? onExportStudioPDF : onExportPDF;
      if (!exportHandler) throw new Error(t("instruction.studioPdfUnavailable"));
      await exportHandler(exportPlan, (done, total) => setExporting({ done, total }), controller.signal, highlight);
    } catch (error) {
      if (!controller.signal.aborted) setExportError(error instanceof Error ? error.message : t("format.exportError"));
    } finally {
      abortRef.current = null;
      setExporting(null);
    }
  };
  const retryShare = async () => {
    if (!onRetryExport || exporting || retryingShare) return;
    setExportError(null);
    setRetryingShare(true);
    try {
      const sharedExistingFile = await onRetryExport();
      if (!sharedExistingFile) {
        setRetryingShare(false);
        await exportPdf(retryStudioExport);
      }
    } catch (error) {
      setExportError(error instanceof Error ? error.message : t("format.exportError"));
    } finally {
      setRetryingShare(false);
    }
  };

  const total = parts.size;
  const from = Math.max(0, Math.min(current - STEP_WINDOW / 2, plan.steps.length - STEP_WINDOW));
  const stepWindow = plan.steps.slice(from, from + STEP_WINDOW);

  return (
    <div className="ins-shell" role="dialog" aria-modal="true" aria-label={t("instruction.dialog")} data-testid="panel-instructions">
      <header className={`ins-head${studioPdfAvailable ? " has-studio-pdf" : ""}`} data-testid="header-instructions">
        <div className="ins-head-title">
          <small>{t("instruction.title")}</small>
          <strong data-testid="text-instructions-summary">{t("instruction.summary", {
            steps: plan.steps.length,
            stepUnit: t(plan.steps.length === 1 ? "instruction.stepUnit" : "instruction.stepsUnit"),
            parts: total,
            partUnit: t(total === 1 ? "instruction.partUnit" : "instruction.partsUnit"),
          })}</strong>
        </div>
        <button className="ins-primary" onClick={() => void exportPdf()} disabled={!!exporting || total === 0} aria-label={t("instruction.exportPdf")} data-testid="button-instructions-export-pdf">
          <FileDown size={16} /> PDF
        </button>
        {studioPdfAvailable && (
          <button className="ins-primary ins-studio-pdf" onClick={() => void exportPdf(true)} disabled={!!exporting || total === 0}
            aria-label={t("instruction.exportStudioPdf")} data-testid="button-instructions-export-studio-pdf">
            <FileDown size={16} /> {t("instruction.studioPdfShort")}
          </button>
        )}
        <button className="ins-icon" onClick={onClose} aria-label={t("instruction.close")} data-testid="button-instructions-close"><X size={18} /></button>
      </header>

      {(exporting || retryingShare) && (
        <div className="ins-banner" role="status" data-testid="status-instructions-export">
          <LoaderCircle size={15} className="spin" />
          <span>{retryingShare ? t("instruction.retryingShare") : t("instruction.exporting", { done: exporting!.done, total: exporting!.total })}</span>
          {!retryingShare && <div className="ins-bar"><i style={{ transform: `scaleX(${exporting!.total ? exporting!.done / exporting!.total : 0})` }} /></div>}
          {!retryingShare && <button className="ins-ghost" onClick={() => abortRef.current?.abort()} data-testid="button-instructions-export-cancel">{t("inventory.cancel")}</button>}
        </div>
      )}
      {exporting && Capacitor.getPlatform() === "android" && (
        <div className="ins-banner" role="note">
          <Info size={15} /><span>{t("instruction.background.note")}</span>
        </div>
      )}
      {exportError && (
        <div className="ins-banner is-error" role="alert" data-testid="status-instructions-export-error">
          <span>{exportError}</span>
          <button className="ins-ghost" onClick={() => void (onRetryExport ? retryShare() : exportPdf(retryStudioExport))} disabled={!!exporting || retryingShare}
            data-testid="button-instructions-export-retry">{t("inventory.retry")}</button>
          <button className="ins-ghost" onClick={() => setExportError(null)} aria-label={t("common.close")} data-testid="button-instructions-export-dismiss"><X size={14} /></button>
        </div>
      )}

      <div className="ins-body">
        <section className="ins-preview" aria-label={`${t("format.preview")} ${t("instruction.stepNumber", { number: current + 1 })}`}>
          <StepPartsBox document={document} partIds={step.partIds} callouts={step.callouts} paused={Boolean(exporting)} />
          <div className="ins-model">
          {exporting ? (
            <div className="ins-empty" role="status">{t("instruction.previewPaused")}</div>
          ) : total === 0 ? (
            <div className="ins-empty" data-testid="text-instructions-empty">
              <strong>{t("instruction.emptyModel")}</strong>
              <span>{t("instruction.emptyHint")}</span>
            </div>
          ) : (
            <BuilderCanvas
              showConstructionControls={false}
              darkMode={darkMode}
              viewRotation={step.rotation}
              viewStepId={step.id}
              viewCamera={step.camera}
              onViewCameraChange={(camera, rotation) => patchStep({
                camera,
                ...(rotation ? { rotation } : {}),
              })}
              instructionFocusIds={focusIds}
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
            <button className="ins-icon" onClick={() => go(current - 1)} disabled={current === 0} aria-label={t("instruction.previous")} data-testid="button-instructions-prev"><ChevronLeft size={20} /></button>
            <label className="ins-jump">
              <span className="sr-only">{t("instruction.stepNumberField")}</span>
              <input type="number" inputMode="numeric" min={1} max={plan.steps.length} value={current + 1}
                onChange={e => { const n = Number(e.target.value); if (Number.isFinite(n) && n >= 1) go(n - 1); }}
                data-testid="input-instructions-step-number" />
              <span>/ {plan.steps.length}</span>
            </label>
            <button className="ins-icon" onClick={() => go(current + 1)} disabled={current === plan.steps.length - 1} aria-label={t("instruction.next")} data-testid="button-instructions-next"><ChevronRight size={20} /></button>
          </div>
          </div>
        </section>

        <section className="ins-side">
          <nav className="ins-strip" aria-label={t("instruction.steps")}>
            {stepWindow.map((s, k) => {
              const i = from + k;
              return (
                <button key={s.id} className={i === current ? "is-active" : ""} onClick={() => go(i)} aria-current={i === current ? "step" : undefined}
                  aria-label={t("instruction.stepLabel", { title: t("instruction.stepNumber", { number: i + 1 }), count: s.partIds.length })} data-testid={`button-instructions-step-${s.id}`}>
                  <b>{i + 1}</b><small>{s.partIds.length}</small>
                </button>
              );
            })}
          </nav>

          <div className="ins-card">
            <button className="ins-ghost ins-highlight" aria-pressed={highlight}
              onClick={() => setHighlight(value => !value)} data-testid="button-instructions-highlight">
              {t("instruction.highlight", { state: highlight ? t("instruction.on") : t("instruction.off") })}
            </button>
            <label className="ins-field">
              <span>{t("instruction.notes")}</span>
              <textarea rows={2} value={step.notes} maxLength={2000} onChange={e => patchStep({ notes: e.target.value })} placeholder={t("instruction.notesExample")} data-testid="input-instructions-step-notes" />
            </label>
            <fieldset className="ins-rot">
              <legend>{t("instruction.rotateView")}</legend>
              {(["X", "Y", "Z"] as const).map((axis, a) => (
                <label key={axis} className="ins-field">
                  <span>{axis}</span>
                  <input type="text" inputMode="decimal" value={angleDrafts[angleDraftKey(step.id, a)] ?? String(rotation[a])}
                    onChange={e => setRotationDraft(step.id, a, e.target.value)} onBlur={e => commitAngleField(step.id, a, e.currentTarget.value)}
                    onKeyDown={e => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                    aria-label={t("instruction.rotationAxis", { axis })} data-testid={`input-instructions-rotation-${axis.toLowerCase()}`} />
                </label>
              ))}
              {(step.rotation || rotation.some(angle => Math.abs(angle) > 0.0001)) && (
                <button className="ins-ghost" onClick={resetRotation} data-testid="button-instructions-rotation-reset">{t("instruction.resetRotation")}</button>
              )}
            </fieldset>
            <p className="ins-hint">{t("instruction.cameraInfo")}</p>
            <div className="ins-actions">
              <button className="ins-ghost" onClick={addStep} data-testid="button-instructions-add-step"><Plus size={15} /> {t("instruction.addStep")}</button>
              <button className="ins-ghost" onClick={() => { setConfirmDeleteAll(false); setShowAutoConfirm(true); }} disabled={!total || !!exporting || !!autoProgress}
                data-testid="button-instructions-auto-generate"><Sparkles size={15} /> {t("instruction.autoGenerate")}</button>
              <button className="ins-ghost is-danger" onClick={() => { setConfirmDelete(false); setShowAutoConfirm(false); setConfirmDeleteAll(true); }}
                disabled={!!exporting || !!autoProgress} aria-label={t("instruction.deleteAllSteps")} title={t("instruction.deleteAllSteps")}
                data-testid="button-instructions-delete-all"><Trash2 size={15} /> {t("instruction.deleteAllSteps")}</button>
              <button className="ins-ghost" onClick={() => moveStep(-1)} disabled={current === 0} aria-label={t("instruction.moveEarlier")} data-testid="button-instructions-move-up"><ArrowUp size={15} /></button>
              <button className="ins-ghost" onClick={() => moveStep(1)} disabled={current === plan.steps.length - 1} aria-label={t("instruction.moveLater")} data-testid="button-instructions-move-down"><ArrowDown size={15} /></button>
              {confirmDelete ? (
                <span className="ins-confirm">
                  <button className="ins-danger" onClick={deleteStep} data-testid="button-instructions-delete-confirm">{t("instruction.delete")}</button>
                  <button className="ins-ghost" onClick={() => setConfirmDelete(false)} data-testid="button-instructions-delete-cancel">{t("instruction.no")}</button>
                </span>
              ) : (
                <button className="ins-ghost is-danger" onClick={() => setConfirmDelete(true)} disabled={plan.steps.length < 2}
                  aria-label={t("instruction.deleteStep")} data-testid="button-instructions-delete-step"><Trash2 size={15} /></button>
              )}
            </div>
            {showAutoConfirm && (
              <div className="ins-auto-confirm" role="alertdialog" aria-label={t("instruction.autoGenerate")} data-testid="dialog-instructions-auto-generate">
                <p>{t("instruction.autoGenerateConfirm")}</p>
                <div>
                  <button className="ins-ghost" onClick={() => setShowAutoConfirm(false)} data-testid="button-instructions-auto-cancel">{t("inventory.cancel")}</button>
                  <button className="ins-primary" onClick={() => void generateSteps()} data-testid="button-instructions-auto-confirm">{t("instruction.autoGenerateProceed")}</button>
                </div>
              </div>
            )}
            {confirmDeleteAll && (
              <div className="ins-auto-confirm ins-delete-all-confirm" role="alertdialog" aria-label={t("instruction.deleteAllSteps")} data-testid="dialog-instructions-delete-all">
                <p>{t(plan.studioLayout ? "instruction.deleteAllStepsConfirmStudio" : "instruction.deleteAllStepsConfirm")}</p>
                <div>
                  <button className="ins-ghost" onClick={() => setConfirmDeleteAll(false)} data-testid="button-instructions-delete-all-cancel">{t("inventory.cancel")}</button>
                  <button className="ins-danger" onClick={deleteAllSteps} data-testid="button-instructions-delete-all-confirm">{t("instruction.deleteAllStepsProceed")}</button>
                </div>
              </div>
            )}
            {autoProgress && (
              <div className="ins-auto-progress" role="status" data-testid="status-instructions-auto-generate">
                <LoaderCircle size={15} className="spin" />
                <span>{t("instruction.autoGenerating", { done: autoProgress.completed, total: autoProgress.total })}</span>
                <button className="ins-ghost" onClick={() => autoAbortRef.current?.abort()} data-testid="button-instructions-auto-stop">{t("inventory.cancel")}</button>
              </div>
            )}
            {autoError && <p className="ins-note is-error" role="alert" data-testid="status-instructions-auto-error">{autoError}</p>}
            {confirmDelete && <p className="ins-hint">{t("instruction.deleteParts", { count: step.partIds.length, target: current > 0 ? t("instruction.stepNumber", { number: current }) : t("instruction.followingStep") })}</p>}
          </div>

          <div className="ins-card ins-parts">
            <div className="ins-tabs" role="tablist">
              <button role="tab" aria-selected={scope === "step"} onClick={() => { setScope("step"); setLimit(PAGE); }} data-testid="tab-instructions-step-parts">{t("instruction.inThisStep", { count: step.partIds.length })}</button>
              <button role="tab" aria-selected={scope === "all"} onClick={() => { setScope("all"); setLimit(PAGE); }} data-testid="tab-instructions-all-parts">{t("instruction.allParts", { count: total })}</button>
            </div>
            <input className="ins-search" type="search" value={query} onChange={e => { setQuery(e.target.value); setLimit(PAGE); }} placeholder={t("instruction.searchPart")} aria-label={t("instruction.filterParts")} data-testid="input-instructions-part-search" />
            {selected.size > 0 && (
              <div className="ins-selbar" data-testid="status-instructions-selection">
                <span>{t("instruction.selected", { count: selected.size })}</span>
                <button className="ins-primary" onClick={() => assign([...selected], current)} data-testid="button-instructions-assign-selected">{t("instruction.assignTo", { number: current + 1 })}</button>
                <button className="ins-ghost" onClick={() => setSelected(new Set())} data-testid="button-instructions-clear-selection">{t("instruction.clearSelection")}</button>
              </div>
            )}
            {listed.length === 0 ? (
              <p className="ins-hint" data-testid="text-instructions-no-parts">{query ? t("instruction.noResults") : scope === "step" ? t("instruction.emptyStep") : t("instruction.noPartsAvailable")}</p>
            ) : (
              <ul className="ins-list">
                {listed.slice(0, limit).map(id => {
                  const p = parts.get(id); const owner = stepOf.get(id) ?? 0;
                  return (
                    <li key={id} className={selected.has(id) ? "is-selected" : ""}>
                      <label>
                         <input type="checkbox" checked={selected.has(id)} onChange={() => toggle(id)} aria-label={t("instruction.chooseName", { name: p?.label ?? id })} data-testid={`checkbox-instructions-part-${id}`} />
                        <i style={{ background: p?.color }} />
                         <span><b>{p?.label ?? id}</b><small>{t("instruction.ownedBy", { number: owner + 1 })}</small></span>
                      </label>
                      {owner !== current && (
                         <button className="ins-ghost" onClick={() => assign([id], current)} aria-label={t("instruction.movePartTo", { name: p?.label ?? id, number: current + 1 })} data-testid={`button-instructions-assign-${id}`}>{t("instruction.moveHere")}</button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
            {listed.length > limit && (
              <button className="ins-ghost ins-more" onClick={() => setLimit(l => l + PAGE)} data-testid="button-instructions-more-parts">{t("instruction.showMore", { shown: Math.min(PAGE, listed.length - limit), total: listed.length - limit })}</button>
            )}
            {listed.length > 0 && (
              <button className="ins-ghost ins-more" onClick={() => setSelected(new Set(listed.slice(0, limit)))} data-testid="button-instructions-select-visible">{t("instruction.selectVisible")}</button>
            )}
          </div>

          {plan.studioLayout && (
            <StudioLayoutEditor document={document} plan={plan} layout={plan.studioLayout}
              originalBytes={document.imported?.originalBytes}
              onChange={next => onChange({ ...plan, studioLayout: next, edited: true })} />
          )}
          {(plan.source === "studio" || document.imported?.format === "io") && (
            <p className="ins-note" data-testid="text-instructions-studio-note"><Info size={14} /> {plan.studioLayout
              ? t("instruction.studioNoteEdited")
              : t("instruction.studioNoteMissing")}</p>
          )}
          {plan.warnings.length > 0 && (
            <ul className="ins-note" data-testid="list-instructions-warnings">{plan.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
          )}
        </section>
      </div>
    </div>
  );
}
