import { useCallback, useEffect, useRef, useState } from "react";

import {
  BRICK_DEFINITIONS,
  BRICK_HEIGHT,
  createEmptyDocument,
  clampRotationAngle,
  normalizeDocument,
  rotateQuarterTurn,
  snapPosition,
  type Brick,
  type BrickType,
  type BuilderDocument,
  type Position3,
  type ToolMode,
} from "./model";
import { brickBounds, clampBrickToGround, normalizeTiltAngle } from "./brick-transform";
import { commit, createHistory, redo, undo, type HistoryState } from "./history";
import type { LibraryPart } from "../parts/types";
import { ensureCatalog, resolveStoredInventory, useCatalog } from "../catalog/client";
import { refreshedCatalogModel } from "../catalog/refresh-model";
import { resolveColor } from "../formats/colors";
import { selectionColorEvidence } from "../catalog/color-evidence";
import { getColorEvidenceState } from "../catalog/color-evidence-state";
import { updateInstructions } from "../instructions/model";
import { instructionPlanSchema, type InstructionPlan } from "../instructions/types";
import { editImported, moveImported, placePreparedPart, placeInventoryPart, placeInventoryBatch, prepareLibraryPart, recolorImported, rotateImported, rotateSelection, setImportedRotation, tiltImported, type PreparedPart } from "./ldraw-editing";
import { inheritStackingBounds, localPartBounds } from "../engine/stacking";
import { worldMatrix } from "../engine/ldraw-geometry";
import { constructionTransform } from "../connections/engine";
import type { Affine, ImportedModel } from "../formats/types";
import { groundedTransform, modelGround } from "./positioning";
import type { Inventory, InventoryChoice } from "../inventory/types";
import { MAX_INVENTORY_SPREAD_UNITS, replaceInventory, requireAvailable, type InventorySpreadRequest, type InventorySpreadResult } from "../inventory/accounting";
import {
  listProjectSummaries,
  type ProjectSummary,
  loadCurrentProject,
  loadProject,
  requestPersistentStorage,
  saveProject,
  createImportedProject,
} from "@/storage/database";

export interface ModelAnalysis {
  count: number;
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number } | null;
  overlapCount: number;
}

interface AnalysisResponse extends ModelAnalysis {
  requestId: number;
}

export function useBuilder() {
  const catalog = useCatalog();
  const [history, setHistory] = useState<HistoryState>(() =>
    createHistory(createEmptyDocument()),
  );
  const groundRef = useRef<{ initial?: ImportedModel; floor?: number }>({});
  useEffect(() => {
    groundRef.current = { initial: history.document.imported };
  }, [history.document.id, history.document.imported?.originalBytes]);
  const constructionGround = useCallback((model: ImportedModel) => {
    const state = groundRef.current;
    // Evaluate lazily, but retain the initial scene floor through edits and undo.
    state.floor ??= modelGround(state.initial ? { ...state.initial, resources: model.resources } : model);
    return state.floor;
  }, []);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedType, setSelectedType] = useState<BrickType>("brick-2x4");
  const [selectedColor, setSelectedColorValue] = useState("#B40000");
  const [selectedColorCode, setSelectedColorCode] = useState<string | undefined>("4");
  const [preparedPart, setPreparedPart] = useState<PreparedPart | null>(null);
  const [selectedInventory, setSelectedInventory] = useState<InventoryChoice | null>(null);
  const placementRef = useRef<{ prepared: PreparedPart; inventory?: InventoryChoice } | null>(null);
  const [partLoading, setPartLoading] = useState(false);
  const [partError, setPartError] = useState<string | null>(null);
  const partControllerRef = useRef<AbortController | null>(null);
  const spreadControllerRef = useRef<AbortController | null>(null);
  useEffect(() => () => {
    partControllerRef.current?.abort();
    spreadControllerRef.current?.abort();
  }, []);
  const [toolMode, setToolModeState] = useState<ToolMode>("view");
  const setToolMode = useCallback((mode: ToolMode) => {
    if (mode === "view") setSelectedId(null);
    setToolModeState(mode);
  }, []);
  const [isReady, setIsReady] = useState(false);
  useEffect(() => {
    if (!isReady || catalog.status !== "ready" || !historyRef.current.document.imported) return;
    const cache = new WeakMap();
    const apply = (document: BuilderDocument) => document.imported
      ? { ...document, imported: refreshedCatalogModel(document.imported, cache) } : document;
    const current = historyRef.current;
    const next = { document: apply(current.document), past: current.past.map(apply), future: current.future.map(apply) };
    historyRef.current = next; documentRef.current = next.document; setHistory(next);
  }, [isReady, catalog.status]);
  const [isSaving, setIsSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [modelAnalysis, setModelAnalysis] = useState<ModelAnalysis>({
    count: 0,
    bounds: null,
    overlapCount: 0,
  });
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const historyRef = useRef(history);
  const documentRef = useRef(history.document);
  const rotationEditRef = useRef<HistoryState | null>(null);
  const lastSavedDocumentRef = useRef<BuilderDocument | null>(null);
  const analysisIdRef = useRef(0);
  const analysisWorkerRef = useRef<Worker | null>(null);

  useEffect(() => {
    historyRef.current = history;
    documentRef.current = history.document;
  }, [history]);

  const replaceDocument = useCallback((document: BuilderDocument, alreadySaved = false) => {
    const opened = normalizeDocument(document);
    partControllerRef.current?.abort();
    spreadControllerRef.current?.abort();
    rotationEditRef.current = null;
    placementRef.current = null;
    setPreparedPart(null); setSelectedInventory(null); setPartLoading(false); setPartError(null);
    const next = createHistory(opened);
    historyRef.current = next;
    documentRef.current = opened;
    lastSavedDocumentRef.current = alreadySaved ? opened : null;
    setHistory(next);
  }, []);

  const refreshProjects = useCallback(async () => {
    const savedProjects = await listProjectSummaries();
    setProjects(savedProjects);
    return savedProjects;
  }, []);

  const restoreLastProject = useCallback(async (): Promise<boolean> => {
    let restored = false;
    try {
      const catalogReady = ensureCatalog().catch(() => undefined);
      const stored = await loadCurrentProject();
      if (stored?.imported) await catalogReady;
      if (stored) {
        replaceDocument(stored.imported ? { ...stored, imported: refreshedCatalogModel(stored.imported) } : stored, true);
        setToolMode("view");
        setSavedAt(stored.updatedAt);
        restored = true;
      } else {
        replaceDocument(createEmptyDocument());
      }
      await requestPersistentStorage();
      setSaveError(null);
    } catch (error) {
      setSaveError(
        error instanceof Error ? error.message : "Projekt konnte nicht geladen werden.",
      );
      replaceDocument(createEmptyDocument());
    } finally {
      setIsReady(true);
    }
    await refreshProjects().catch(() => undefined);
    return restored;
  }, [refreshProjects, replaceDocument]);

  useEffect(() => {
    void restoreLastProject();
  }, [restoreLastProject]);

  const persist = useCallback(async () => {
    if (!isReady) return;
    setIsSaving(true);
    try {
      const snapshot = documentRef.current;
      await saveProject(snapshot);
      lastSavedDocumentRef.current = snapshot;
      setSavedAt(new Date().toISOString());
      setSaveError(null);
      await refreshProjects().catch(() => undefined);
    } catch (error) {
      setSaveError(
        error instanceof Error ? error.message : "Speichern fehlgeschlagen.",
      );
      throw error;
    } finally {
      setIsSaving(false);
    }
  }, [isReady, refreshProjects]);

  useEffect(() => {
    if (!isReady || history.document === lastSavedDocumentRef.current) return;
    const timeout = window.setTimeout(
      () => void persist().catch(() => undefined),
      450,
    );
    return () => window.clearTimeout(timeout);
  }, [history.document, isReady, persist]);

  useEffect(() => {
    const worker = new Worker(
      new URL("../engine/model-analysis.worker.ts", import.meta.url),
      { type: "module" },
    );
    analysisWorkerRef.current = worker;
    worker.addEventListener("message", (event: MessageEvent<AnalysisResponse>) => {
      if (event.data.requestId !== analysisIdRef.current) return;
      setModelAnalysis({
        count: event.data.count,
        bounds: event.data.bounds,
        overlapCount: event.data.overlapCount,
      });
    });
    return () => {
      worker.terminate();
      analysisWorkerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const requestId = ++analysisIdRef.current;
    analysisWorkerRef.current?.postMessage({
      requestId,
      bricks: history.document.bricks,
    });
  }, [history.document.bricks]);

  const updateDocument = useCallback((updater: (document: BuilderDocument) => BuilderDocument) => {
    const current = historyRef.current;
    const nextDocument = updater(current.document);
    const next = commit(current, nextDocument);
    historyRef.current = next;
    documentRef.current = next.document;
    setHistory(next);
  }, []);

  const setInstructionPlan = useCallback((plan: InstructionPlan) => {
    const checked = instructionPlanSchema.parse(plan);
    updateDocument(document => updateInstructions(document, checked));
  }, [updateDocument]);

  const setSelectedColor = useCallback(
    (color: string, code?: string, additionalIds: string[] = []) => {
      const document = historyRef.current.document;
      const ids = new Set(selectedId ? [selectedId, ...additionalIds] : []);
      const instances = document.imported?.instances.filter(instance => ids.has(instance.id)) ?? [];
      const references = instances.length ? instances.map(instance => instance.part.ldrawId)
        : selectedId && document.bricks.some(brick => brick.id === selectedId)
          ? [BRICK_DEFINITIONS[document.bricks.find(brick => brick.id === selectedId)!.type].ldrawId]
          : placementRef.current ? [placementRef.current.prepared.part.ldrawId] : [];
      const constraint = selectionColorEvidence(references, getColorEvidenceState().index);
      if (constraint.codes && (!code || !constraint.codes.includes(code))) return;
      setSelectedColorValue(color);
      setSelectedColorCode(code);
      if (!selectedId) return;
      if (instances.length) {
        updateDocument(document => instances.reduce((next, instance) => recolorImported(next, instance.id, color, code), document));
        return;
      }
      updateDocument((document) => ({
        ...document,
        updatedAt: new Date().toISOString(),
        bricks: document.bricks.map((brick) =>
          brick.id === selectedId ? { ...brick, color } : brick,
        ),
      }));
    },
    [selectedId, updateDocument],
  );

  const selectLibraryPart = useCallback(async (part: LibraryPart) => {
    partControllerRef.current?.abort();
    placementRef.current = null; setPreparedPart(null); setSelectedInventory(null);
    const controller = new AbortController();
    partControllerRef.current = controller;
    setPartLoading(true); setPartError(null);
    try {
      const prepared = await prepareLibraryPart(part, controller.signal);
      if (controller.signal.aborted) return false;
      setPreparedPart(prepared);
      placementRef.current = { prepared };
      setSelectedId(null); setToolMode("build");
      return true;
    } catch (error) {
      if (!controller.signal.aborted) setPartError(error instanceof Error ? error.message : String(error));
      return false;
    } finally { if (!controller.signal.aborted) setPartLoading(false); }
  }, []);
  const selectInventoryPart = useCallback(async (choice: InventoryChoice) => {
    partControllerRef.current?.abort();
    const controller = new AbortController();
    partControllerRef.current = controller;
    placementRef.current = null; setPreparedPart(null); setSelectedInventory(null);
    setPartLoading(true); setPartError(null);
    const projectId = documentRef.current.id;
    try {
      const row = requireAvailable(documentRef.current, choice);
      const preview = await resolveStoredInventory(documentRef.current.inventory!);
      controller.signal.throwIfAborted();
      const resolution = preview.resolutions[row.id];
      const candidate = resolution?.parts.find(part => part.ldrawId === choice.ldrawId);
      if (!candidate || !resolution.colors.some(color => color.ldrawCode === choice.colorCode)) throw new Error(`BrickLink ${row.partId}, Farbe ${row.colorId}: Auswahl nicht belegt. Bitte erneut auswählen.`);
      const prepared = await prepareLibraryPart({
        id: `inventory:${choice.listId}:${choice.rowId}`, packageId: "catalog",
        ldrawId: candidate.ldrawId, brickLinkId: row.partId, name: candidate.name,
        category: "Teileliste", keywords: [], file: `parts/${candidate.ldrawId}.dat`,
      }, controller.signal);
      controller.signal.throwIfAborted();
      if (documentRef.current.id !== projectId) return false;
      requireAvailable(documentRef.current, choice);
      const color = resolveColor(choice.colorCode);
      if (!color) throw new Error(`BrickLink-Farbe ${row.colorId}: LDraw-Farbe nicht verfügbar.`);
      placementRef.current = { prepared, inventory: { ...choice } };
      setPreparedPart(prepared); setSelectedInventory({ ...choice });
      setSelectedColorValue(color.hex); setSelectedColorCode(choice.colorCode);
      setSelectedId(null); setToolMode("build");
      return true;
    } catch (error) {
      if (!controller.signal.aborted) setPartError(error instanceof Error ? error.message : String(error));
      return false;
    } finally { if (!controller.signal.aborted) setPartLoading(false); }
  }, []);
  const replacePartsInventory = useCallback((inventory: Inventory, expectedProjectId: string) => {
    updateDocument(document => {
      if (document.id !== expectedProjectId) throw new Error("Projekt wurde inzwischen gewechselt.");
      return replaceInventory(document, inventory);
    });
    partControllerRef.current?.abort();
    placementRef.current = null; setPreparedPart(null); setSelectedInventory(null); setPartLoading(false);
  }, [updateDocument]);
  const cancelPartPreparation = useCallback(() => {
    partControllerRef.current?.abort();
    setPartLoading(false);
  }, []);

  const spreadInventoryParts = useCallback(async (
    requests: InventorySpreadRequest[],
    onProgress: (progress: { stage: "mapping" | "geometry" | "placing"; completed: number; total: number }) => void,
    signal?: AbortSignal,
  ): Promise<InventorySpreadResult> => {
    if (requests.some(request => !Number.isSafeInteger(request.quantity) || request.quantity < 1)) {
      throw new Error("Ungültige Stückzahl für die Sammelplatzierung.");
    }
    const initial = documentRef.current;
    const projectId = initial.id;
    const initialInventory = initial.inventory;
    const inventoryId = initialInventory?.id;
    if (!initialInventory || !inventoryId) throw new Error("Keine Teileliste mehr vorhanden.");
    const assertCurrentProjectAndInventory = () => {
      const current = documentRef.current;
      if (current.id !== projectId || current.inventory !== initialInventory || current.inventory?.id !== inventoryId) {
        throw new Error("Projekt oder Teileliste wurde inzwischen gewechselt.");
      }
    };
    if (!requests.length) throw new Error("Es gibt keine eindeutig zugeordneten, verfügbaren Teile zum Verteilen.");
    const controller = new AbortController();
    spreadControllerRef.current?.abort();
    spreadControllerRef.current = controller;
    const abort = () => controller.abort();
    if (signal?.aborted) controller.abort();
    signal?.addEventListener("abort", abort, { once: true });
    try {
      controller.signal.throwIfAborted();
      onProgress({ stage: "mapping", completed: 0, total: requests.length });
      const preview = await resolveStoredInventory(initial.inventory!);
      controller.signal.throwIfAborted();
      assertCurrentProjectAndInventory();
      const totalRequested = requests.reduce((sum, request) => sum + request.quantity, 0);
      const limit = Math.min(totalRequested, MAX_INVENTORY_SPREAD_UNITS);
      let remainingLimit = limit;
      const accepted: InventorySpreadRequest[] = [];
      for (const request of requests) {
        if (!Number.isSafeInteger(request.quantity) || request.quantity < 1) continue;
        const quantity = Math.min(request.quantity, remainingLimit);
        if (quantity > 0) accepted.push({ choice: { ...request.choice }, quantity });
        remainingLimit -= quantity;
        if (!remainingLimit) break;
      }
      if (!accepted.length) throw new Error("Es gibt keine verfügbaren Teile zum Verteilen.");
      for (const { choice } of accepted) {
        const row = initial.inventory!.rows.find(value => value.id === choice.rowId);
        const resolution = preview.resolutions[choice.rowId];
        if (choice.listId !== inventoryId || !row || row.itemType !== "P" ||
          !resolution?.parts.some(part => part.ldrawId === choice.ldrawId) ||
          !resolution.colors.some(color => color.ldrawCode === choice.colorCode)) {
          throw new Error(`BL ${row?.partId ?? choice.rowId}: Zuordnung ist nicht mehr belegt. Bitte erneut prüfen.`);
        }
      }
      onProgress({ stage: "mapping", completed: accepted.length, total: accepted.length });
      const partIds = [...new Set(accepted.map(request => request.choice.ldrawId))];
      const preparedByPart = new Map<string, PreparedPart>();
      const failedByPart = new Map<string, string>();
      onProgress({ stage: "geometry", completed: 0, total: partIds.length });
      for (const [index, ldrawId] of partIds.entries()) {
        controller.signal.throwIfAborted();
        assertCurrentProjectAndInventory();
        const mapped = accepted.find(request => request.choice.ldrawId === ldrawId)!;
        const row = initial.inventory!.rows.find(value => value.id === mapped.choice.rowId)!;
        const part = preview.resolutions[row.id].parts.find(value => value.ldrawId === ldrawId)!;
        try {
          const prepared = await prepareLibraryPart({
            id: `inventory:${inventoryId}:${row.id}`, packageId: "catalog", ldrawId,
            brickLinkId: row.partId, name: part.name, category: "Teileliste", keywords: [],
            file: `parts/${ldrawId}.dat`,
          }, controller.signal);
          controller.signal.throwIfAborted();
          assertCurrentProjectAndInventory();
          preparedByPart.set(ldrawId, prepared);
        } catch (error) {
          controller.signal.throwIfAborted();
          assertCurrentProjectAndInventory();
          if (error && typeof error === "object" && "name" in error && error.name === "AbortError") throw error;
          failedByPart.set(ldrawId, error instanceof Error ? error.message : String(error));
        }
        onProgress({ stage: "geometry", completed: index + 1, total: partIds.length });
        await new Promise<void>(resolve => setTimeout(resolve, 0));
      }
      controller.signal.throwIfAborted();
      assertCurrentProjectAndInventory();
      const placeable = accepted.filter(request => !failedByPart.has(request.choice.ldrawId));
      const placed = placeable.reduce((sum, request) => sum + request.quantity, 0);
      const skipped = accepted.reduce((sum, request) =>
        sum + (failedByPart.has(request.choice.ldrawId) ? request.quantity : 0), 0);
      const failures = [...failedByPart].map(([ldrawId, reason]) => ({
        ldrawId,
        quantity: accepted.reduce((sum, request) =>
          sum + (request.choice.ldrawId === ldrawId ? request.quantity : 0), 0),
        reason,
      }));
      if (placeable.length) {
        onProgress({ stage: "placing", completed: 0, total: placed });
        updateDocument(document => {
          if (document.id !== projectId || document.inventory !== initialInventory) {
            throw new Error("Projekt oder Teileliste wurde inzwischen gewechselt.");
          }
          return placeInventoryBatch(document, placeable, preparedByPart);
        });
        onProgress({ stage: "placing", completed: placed, total: placed });
      }
      return { placed, skipped, deferred: totalRequested - limit, failures };
    } finally {
      signal?.removeEventListener("abort", abort);
      if (spreadControllerRef.current === controller) spreadControllerRef.current = null;
    }
  }, [updateDocument]);

  const place = useCallback(
    (position: Position3) => {
      if (toolMode === "delete" || partLoading) return;
      const selection = placementRef.current;
      if (!selection) { setPartError("Bitte zuerst ein Teil aus dem LDraw-Katalog oder der Teileliste auswählen."); return; }
      try {
        let id: string | null = null;
        updateDocument(document => {
          let next = selection.inventory
            ? placeInventoryPart(document, selection.prepared, position, selection.inventory, { hex: selectedColor, code: selectedColorCode })
            : placePreparedPart(document, selection.prepared, position, selectedColor, selectedColorCode);
          id = next.imported!.instances.at(-1)!.id;
          inheritStackingBounds(document.imported, next.imported!);
          const instance = next.imported!.instances.at(-1)!;
          const origin = { x: position.x, y: -instance.matrix[7] / 20, z: position.z };
           const result = constructionTransform(next.imported!, id, origin);
           next = moveImported(next, id, { x: result.matrix[3] / 20, y: -result.matrix[7] / 20, z: result.matrix[11] / 20 }, false, result.matrix);
          return next;
        });
        setSelectedId(id); setPartError(null);
      } catch (error) { setPartError(error instanceof Error ? error.message : String(error)); }
    },
    [selectedColor, selectedColorCode, partLoading, toolMode, updateDocument],
  );

  const move = useCallback(
    (id: string, position: Position3, transform?: Affine) => {
      if (historyRef.current.document.imported?.instances.some(instance => instance.id === id)) {
        try { updateDocument(document => {
          const model = document.imported!;
          const matrix = groundedTransform(model, id, position, constructionGround(model), transform);
          const original = model.instances.find(instance => instance.id === id)!;
          if (matrix.every((value, index) => Math.abs(value - original.matrix[index]) < 1e-10)) return document;
          return moveImported(document, id, position, false, matrix);
        }); } catch (error) { setPartError(error instanceof Error ? error.message : String(error)); }
        return;
      }
      const snapped = snapPosition(position);
      updateDocument(document => {
        const existing = document.bricks.find(brick => brick.id === id);
        if (!existing) return document;
        const next = clampBrickToGround({ ...existing, ...snapped });
        if (next.x === existing.x && next.y === existing.y && next.z === existing.z) return document;
        return {
          ...document, updatedAt: new Date().toISOString(),
          bricks: document.bricks.map(brick => brick.id === id ? next : brick),
        };
      });
    },
    [updateDocument, constructionGround],
  );

  const moveGroup = useCallback((ids: readonly string[], delta: Position3) => {
    if (![delta.x, delta.y, delta.z].every(Number.isFinite)) return;
    const requested = new Set(ids);
    if (requested.size < 2) return;
    updateDocument(document => {
      const bricks = document.bricks.filter(brick => requested.has(brick.id));
      const instances = document.imported?.instances.filter(instance => requested.has(instance.id)) ?? [];
      if (bricks.length + instances.length < 2) return document;

      let next = document;
      const brickIds = new Set(bricks.map(brick => brick.id));
      next = {
        ...next,
        bricks: next.bricks.map(brick => brickIds.has(brick.id)
          ? { ...brick, x: brick.x + delta.x, y: brick.y + delta.y, z: brick.z + delta.z }
          : brick),
      };
      for (const instance of instances) {
        const matrix = [...instance.matrix] as Affine;
        matrix[3] += delta.x * 20;
        matrix[7] -= delta.y * 20;
        matrix[11] += delta.z * 20;
        next = moveImported(next, instance.id, {
          x: instance.matrix[3] / 20 + delta.x,
          y: -instance.matrix[7] / 20 + delta.y,
          z: instance.matrix[11] / 20 + delta.z,
        }, false, matrix);
      }

      // Keep the translation shared if a downward move reaches the construction floor.
      let lift = 0;
      for (const brick of next.bricks) {
        if (brickIds.has(brick.id)) lift = Math.max(lift, -brickBounds(brick).min.y);
      }
      const importedIds = new Set(instances.map(instance => instance.id));
      if (next.imported) {
        const floor = constructionGround(document.imported!);
        for (const instance of next.imported.instances) {
          if (!importedIds.has(instance.id)) continue;
          try {
            const bounds = localPartBounds(next.imported, instance.reference)
              .clone().applyMatrix4(worldMatrix(instance.matrix));
            if (!bounds.isEmpty()) lift = Math.max(lift, floor - bounds.min.y);
          } catch {
            // Keep unresolved parts movable without inventing geometry for their floor bounds.
          }
        }
      }
      lift = Math.max(0, lift);
      if (lift > 1e-9) {
        next = {
          ...next,
          bricks: next.bricks.map(brick => brickIds.has(brick.id)
            ? { ...brick, y: brick.y + lift } : brick),
        };
        for (const id of importedIds) {
          const instance = next.imported?.instances.find(value => value.id === id);
          if (instance) {
            const matrix = [...instance.matrix] as Affine;
            matrix[7] -= lift * 20;
            next = moveImported(next, id, {
              x: instance.matrix[3] / 20,
              y: -instance.matrix[7] / 20 + lift,
              z: instance.matrix[11] / 20,
            }, false, matrix);
          }
        }
      }
      return next === document ? document : { ...next, updatedAt: new Date().toISOString() };
    });
  }, [constructionGround, updateDocument]);

  const remove = useCallback(
    (id: string) => {
      if (historyRef.current.document.imported?.instances.some(instance => instance.id === id)) {
        updateDocument(document => editImported(document, id, () => null));
        setSelectedId(current => current === id ? null : current);
        return;
      }
      updateDocument((document) => ({
        ...document,
        updatedAt: new Date().toISOString(),
        bricks: document.bricks.filter((brick) => brick.id !== id),
      }));
      setSelectedId((current) => (current === id ? null : current));
    },
    [updateDocument],
  );

  // Explicit adjustments bypass snapping/stacking, but never the construction floor.
  const nudgeSelected = useCallback((delta: Position3) => {
    if (!selectedId || ![delta.x, delta.y, delta.z].every(Number.isFinite)) return;
    const document = historyRef.current.document;
    const instance = document.imported?.instances.find(value => value.id === selectedId);
    const brick = document.bricks.find(value => value.id === selectedId);
    if (instance) {
      const matrix = [...instance.matrix] as Affine;
      for (const [index, amount] of [[3, delta.x * 20], [7, -delta.y * 20], [11, delta.z * 20]]) {
        if (amount) matrix[index] = Number((matrix[index] + amount).toFixed(10));
      }
      move(selectedId, { x: matrix[3] / 20, y: -matrix[7] / 20, z: matrix[11] / 20 }, matrix);
    } else if (brick) {
      const next = {
        ...brick, x: Number((brick.x + delta.x).toFixed(10)), y: Math.max(0, Number((brick.y + delta.y).toFixed(10))),
        z: Number((brick.z + delta.z).toFixed(10)),
      };
      const grounded = clampBrickToGround(next);
      if (grounded.x === brick.x && grounded.y === brick.y && grounded.z === brick.z) return;
      updateDocument(current => ({
        ...current, updatedAt: new Date().toISOString(),
        bricks: current.bricks.map(value => value.id === selectedId ? grounded : value),
      }));
    }
  }, [selectedId, move, updateDocument]);
  const changeHeight = useCallback((delta: number) => nudgeSelected({ x: 0, y: delta, z: 0 }), [nudgeSelected]);

  const select = useCallback(
    (id: string | null) => {
      if (toolMode === "delete" && id) {
        remove(id);
        return;
      }
      setSelectedId(id);
      setPartError(null);
      const instance = historyRef.current.document.imported?.instances.find(item => item.id === id);
      if (instance) {
        const color = resolveColor(instance.colorCode);
        if (color) { setSelectedColorValue(color.hex); setSelectedColorCode(instance.colorCode); }
      } else {
        const brick = historyRef.current.document.bricks.find(item => item.id === id);
        if (brick) { setSelectedColorValue(brick.color); setSelectedColorCode(`0x2${brick.color.replace("#", "").toUpperCase()}`); }
      }
    },
    [remove, toolMode],
  );

  useEffect(() => {
    const instance = history.document.imported?.instances.find(item => item.id === selectedId);
    if (!instance) return;
    setSelectedColorValue(resolveColor(instance.colorCode)?.hex ?? "#ff00ff");
    setSelectedColorCode(instance.colorCode);
  }, [history.document.imported, selectedId]);

  const rotateSelected = useCallback(() => {
    if (!selectedId) return;
    if (historyRef.current.document.imported?.instances.some(instance => instance.id === selectedId)) {
      updateDocument(document => {
        const rotated = rotateImported(document, selectedId);
        const model = rotated.imported!;
        const instance = model.instances.find(value => value.id === selectedId)!;
        try {
          const matrix = groundedTransform(model, selectedId,
            { x: instance.matrix[3] / 20, y: -instance.matrix[7] / 20, z: instance.matrix[11] / 20 },
            constructionGround(document.imported!), instance.matrix);
          return moveImported(rotated, selectedId,
            { x: matrix[3] / 20, y: -matrix[7] / 20, z: matrix[11] / 20 }, false, matrix);
        } catch { return rotated; }
      });
      return;
    }
    updateDocument((document) => ({
      ...document,
      updatedAt: new Date().toISOString(),
      bricks: document.bricks.map((brick) =>
        brick.id === selectedId
          ? clampBrickToGround({ ...brick, rotation: rotateQuarterTurn(brick.rotation) })
          : brick,
      ),
    }));
  }, [selectedId, updateDocument]);

  const setSelectedTilt = useCallback((axis: "x" | "z", angle: number) => {
    if (!selectedId || !Number.isFinite(angle)) return;
    const normalized = normalizeTiltAngle(angle);
    updateDocument(document => {
      const imported = document.imported?.instances.find(instance => instance.id === selectedId);
      if (imported && document.imported) {
        const tiltX = axis === "x" ? normalized : imported.tiltX ?? 0;
        const tiltZ = axis === "z" ? normalized : imported.tiltZ ?? 0;
        if (tiltX === (imported.tiltX ?? 0) && tiltZ === (imported.tiltZ ?? 0)) return document;
        const tilted = tiltImported(document, selectedId, tiltX, tiltZ);
        const model = tilted.imported!;
        const changed = model.instances.find(instance => instance.id === selectedId)!;
        try {
          const floor = constructionGround(document.imported);
          const grounded = groundedTransform(model, selectedId,
            { x: changed.matrix[3] / 20, y: -changed.matrix[7] / 20, z: changed.matrix[11] / 20 },
            floor, changed.matrix);
          return moveImported(tilted, selectedId,
            { x: grounded[3] / 20, y: -grounded[7] / 20, z: grounded[11] / 20 }, false, grounded);
        } catch {
          return tilted;
        }
      }
      const brick = document.bricks.find(value => value.id === selectedId);
      if (!brick) return document;
      const tiltX = axis === "x" ? normalized : brick.tiltX ?? 0;
      const tiltZ = axis === "z" ? normalized : brick.tiltZ ?? 0;
      if (tiltX === (brick.tiltX ?? 0) && tiltZ === (brick.tiltZ ?? 0)) return document;
      const changed = clampBrickToGround({ ...brick, tiltX: tiltX || undefined, tiltZ: tiltZ || undefined });
      return {
        ...document,
        updatedAt: new Date().toISOString(),
        bricks: document.bricks.map(value => value.id === selectedId ? changed : value),
      };
    });
  }, [constructionGround, selectedId, updateDocument]);

  const beginSelectedRotationEdit = useCallback(() => {
    rotationEditRef.current ??= historyRef.current;
  }, []);

  const endSelectedRotationEdit = useCallback(() => {
    const initial = rotationEditRef.current;
    if (!initial) return;
    rotationEditRef.current = null;
    const next = commit(initial, historyRef.current.document);
    historyRef.current = next;
    documentRef.current = next.document;
    setHistory(next);
  }, []);

  const setSelectedRotation = useCallback((angle: number, selectedIds: string[] = selectedId ? [selectedId] : []) => {
    if (!selectedId || !Number.isFinite(angle)) return;
    const rotationY = clampRotationAngle(Math.round(angle));
    const transaction = rotationEditRef.current;
    if (transaction) {
      const document = transaction.document;
      const nextDocument = rotateSelection(document, selectedIds, selectedId, rotationY,
        document.imported ? constructionGround(document.imported) : 0);
      const next = { ...transaction, document: nextDocument };
      historyRef.current = next;
      documentRef.current = nextDocument;
      setHistory(next);
      return;
    }
    updateDocument(document => rotateSelection(
      document, selectedIds, selectedId, rotationY,
      document.imported ? constructionGround(document.imported) : 0,
    ));
  }, [constructionGround, selectedId, updateDocument]);

  const deleteSelected = useCallback(() => {
    if (selectedId) remove(selectedId);
  }, [remove, selectedId]);

  const undoChange = useCallback(() => {
    const next = undo(historyRef.current);
    historyRef.current = next;
    documentRef.current = next.document;
    setHistory(next);
    setSelectedId((current) =>
      current && (next.document.bricks.some((brick) => brick.id === current) || next.document.imported?.instances.some(instance => instance.id === current))
        ? current
        : null,
    );
  }, []);

  const redoChange = useCallback(() => {
    const next = redo(historyRef.current);
    historyRef.current = next;
    documentRef.current = next.document;
    setHistory(next);
    setSelectedId((current) =>
      current && (next.document.bricks.some((brick) => brick.id === current) || next.document.imported?.instances.some(instance => instance.id === current))
        ? current
        : null,
    );
  }, []);

  const updateProjectName = useCallback(
    (name: string) => {
      const current = historyRef.current;
      const document = {
        ...current.document,
        name: name || "Neues Modell",
        updatedAt: new Date().toISOString(),
      };
      const next = { ...current, document };
      historyRef.current = next;
      documentRef.current = document;
      setHistory(next);
    },
    [],
  );

  const openProject = useCallback(
    async (id: string) => {
      const project = await loadProject(id);
      if (!project) return false;
      await saveProject(historyRef.current.document);
      const refreshed = project.imported ? { ...project, imported: refreshedCatalogModel(project.imported) } : project;
      await saveProject(refreshed);
      replaceDocument(refreshed, true);
      setSavedAt(project.updatedAt);
      setSelectedId(null);
      setToolMode("view");
      await refreshProjects();
      return true;
    },
    [refreshProjects, replaceDocument],
  );

  const startNewProject = useCallback(async () => {
    if (isReady) await saveProject(historyRef.current.document);
    const document = createEmptyDocument();
    replaceDocument(document);
    setSelectedId(null);
    setToolMode("view");
    await saveProject(document);
    setSavedAt(document.updatedAt);
    await refreshProjects();
  }, [isReady, refreshProjects, replaceDocument]);

  const importProject = useCallback(async (imported: BuilderDocument) => {
    await createImportedProject(historyRef.current.document, imported);
    replaceDocument(imported, true);
    setSelectedId(null);
    setToolMode("view");
    setSavedAt(imported.updatedAt);
    setSaveError(null);
    // The import is committed even if refreshing the project list subsequently fails.
    await refreshProjects().catch(() => undefined);
  }, [refreshProjects, replaceDocument]);

  const document = history.document;
  return {
    document,
    setInstructionPlan,
    imported: document.imported,
    importProject,
    bricks: document.bricks,
    selectedId,
    selectedType,
    selectedColor,
    selectedColorCode,
    selectedPart: preparedPart?.part ?? null,
    selectedInstance: document.imported?.instances.find(instance => instance.id === selectedId) ?? null,
    selectLibraryPart, selectInventoryPart, replacePartsInventory, selectedInventory, cancelPartPreparation, partLoading, partError,
    spreadInventoryParts,
    toolMode,
    canUndo: history.past.length > 0,
    canRedo: history.future.length > 0,
    savedAt,
    isSaving,
    saveError,
    isReady,
    modelAnalysis,
    setSelectedType,
    setSelectedColor,
    setToolMode,
    select,
    place,
    move,
    moveGroup,
    changeHeight,
    nudgeSelected,
    rotateSelected,
    setSelectedRotation,
    beginSelectedRotationEdit,
    endSelectedRotationEdit,
    setSelectedTilt,
    deleteSelected,
    undo: undoChange,
    redo: redoChange,
    save: persist,
    projects,
    refreshProjects,
    openProject,
    projectName: document.name,
    setProjectName: updateProjectName,
    brickCount: document.bricks.length + (document.imported?.instances.length ?? 0),
    startNewProject,
    restoreLastProject,
  };
}
