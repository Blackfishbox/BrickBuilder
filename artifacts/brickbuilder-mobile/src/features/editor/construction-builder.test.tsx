// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { useBuilder } from "./useBuilder";
import { createEmptyDocument } from "./model";
import { prepareLibraryPart, type PreparedPart } from "./ldraw-editing";
import { parseLDraw } from "../formats/ldraw/parser";
import type { ImportedModel } from "../formats/types";
import { parseInventory } from "../inventory/import";
import { allocatedCounts } from "../inventory/accounting";
import { builderDatabase, loadProject } from "@/storage/database";
import { brickBounds } from "./brick-transform";
import { stackingBounds } from "../engine/stacking";
import { localPartBounds } from "../engine/stacking";
import { worldMatrix } from "../engine/ldraw-geometry";
import { activeConnections } from "../connections/engine";

vi.mock("../catalog/client", () => ({
  useCatalog: () => ({ status: "ready" }),
  ensureCatalog: async () => {},
  resolveStoredInventory: async (inventory: ReturnType<typeof parseInventory>) => ({
    inventory, resolutions: Object.fromEntries(inventory.rows.map(row => [row.id, {
      parts: [{ ldrawId: "3022", name: "Plate 2 x 2" }],
      colors: [{ ldrawCode: "4", name: "Red", hex: "#B40000" }],
    }])),
  }),
}));
vi.mock("./ldraw-editing", async original => ({
  ...await original<typeof import("./ldraw-editing")>(), prepareLibraryPart: vi.fn(),
}));
let root: ReturnType<typeof createRoot> | undefined;
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined; await builderDatabase.delete(); vi.unstubAllGlobals(); vi.clearAllMocks();
});

it("commits inventory snapping once and preserves exact height through manual edits, undo and local save", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("Worker", class { addEventListener() {} postMessage() {} terminate() {} });
  await builderDatabase.open();
  let editor!: ReturnType<typeof useBuilder>;
  function Harness() { editor = useBuilder(); return null; }
  root = createRoot(document.createElement("div"));
  await act(async () => { root!.render(<Harness />); });
  await act(async () => { await vi.waitFor(() => expect(editor.isReady).toBe(true)); });
  const resources = Object.fromEntries(["bricks", "plates"].flatMap(group =>
    JSON.parse(readFileSync(resolve(`public/parts/ldraw-${group}-2026-10-31.json`), "utf8")).files,
  ).map(file => [file.path, file])) as ImportedModel["resources"];
  function model(sourceText: string): ImportedModel {
    const imported: ImportedModel = { version: 1, format: "ldr", sourceName: "fixture.ldr", sourceText,
      originalBytes: Array.from(new TextEncoder().encode(sourceText)), ...parseLDraw(sourceText), resources, legalDocuments: [] };
    imported.instances.forEach(instance => { instance.part.status = "resolved"; });
    return imported;
  }
  const base = model("1 4 4.6 -24 3.4 1 0 0 0 1 0 0 0 1 3001.dat");
  await act(async () => { await editor.importProject({ ...createEmptyDocument(), imported: base }); });
  expect(editor.toolMode).toBe("view");
  const inventory = parseInventory("part_id,color_id,quantity\n3022,5,1", "self-authored.csv");
  await act(async () => editor.replacePartsInventory(inventory, editor.document.id));
  const prepared: PreparedPart = { bottom: -0.4, part: {
    id: "plate", packageId: "test", ldrawId: "3022", name: "Plate 2 x 2", category: "", keywords: [], file: "parts/3022.dat",
  }, model: model("1 4 0 0 0 1 0 0 0 1 0 0 0 1 3022.dat") };
  vi.mocked(prepareLibraryPart).mockResolvedValue(prepared);
  const beforePreview = editor.document;
  const canUndoBeforePreview = editor.canUndo;
  await act(async () => { await editor.selectInventoryPart({ listId: inventory.id, rowId: inventory.rows[0].id, ldrawId: "3022", colorCode: "4" }); });
  expect(editor.toolMode).toBe("build");
  expect(editor.placementPreview).toBe(prepared);
  expect(editor.document).toBe(beforePreview);
  expect(editor.canUndo).toBe(canUndoBeforePreview);
  expect(allocatedCounts(editor.document).get(inventory.rows[0].id) ?? 0).toBe(0);
  await act(async () => editor.place({ x: 0.28, y: 1.4, z: 0.2 }));
  const placed = editor.imported!.instances[1], id = placed.id;
  expect(placed.matrix[3]).toBeCloseTo(4.6);
  expect(placed.matrix[7]).toBeCloseTo(-32);
  expect(placed.matrix[11]).toBeCloseTo(3.4);
  expect(allocatedCounts(editor.document).get(inventory.rows[0].id)).toBe(1);
  await act(async () => editor.undo());
  expect(editor.imported!.instances).toHaveLength(1);
  expect(allocatedCounts(editor.document).get(inventory.rows[0].id) ?? 0).toBe(0);
  await act(async () => editor.redo());
  expect(editor.imported!.instances[1]).toEqual(placed);
  await act(async () => editor.select(id));
  await act(async () => editor.changeHeight(-0.4));
  expect(editor.imported!.instances[1].matrix[7]).toBeCloseTo(-24);
  expect(editor.imported!.instances[1].matrix[3]).toBeCloseTo(4.6);
  await act(async () => editor.undo());
  await act(async () => editor.place({ x: 0.28, y: 1.4, z: 0.2 }));
  expect(editor.imported!.instances).toHaveLength(2);
  expect(editor.partError).toBeTruthy();
  await act(async () => { await editor.save(); });
  const stored = await loadProject(editor.document.id);
  expect(stored!.imported!.instances.find(instance => instance.id === id)).toEqual(placed);
  expect(editor.imported!.instances[0]).toMatchObject({
    id: base.instances[0].id, reference: base.instances[0].reference,
    matrix: base.instances[0].matrix, colorCode: base.instances[0].colorCode,
  });
  expect(editor.imported!.sourceText).toBe(base.sourceText);
  expect(editor.imported!.originalBytes).toEqual(base.originalBytes);
  for (let i = 0; i < 10; i++) await act(async () => editor.changeHeight(-0.4));
  expect(editor.imported!.instances.find(instance => instance.id === id)!.matrix[7]).toBeCloseTo(-8);
  const floorDocument = editor.document;
  await act(async () => editor.changeHeight(-0.4));
  expect(editor.document).toBe(floorDocument);
  await act(async () => editor.nudgeSelected({ x: 0.05, y: 0.05, z: -0.05 }));
  const fine = editor.imported!.instances.find(instance => instance.id === id)!;
  expect(fine.matrix[3]).toBeCloseTo(5.6);
  expect(fine.matrix[7]).toBeCloseTo(-9);
  expect(fine.matrix[11]).toBeCloseTo(2.4);
  expect(allocatedCounts(editor.document).get(inventory.rows[0].id)).toBe(1);
  await act(async () => editor.undo());
  expect(editor.document).toBe(floorDocument);
  await act(async () => editor.redo());
  await act(async () => { await editor.save(); });
  expect((await loadProject(editor.document.id))!.imported!.instances.find(instance => instance.id === id)).toEqual(fine);
});

it("clears pending placement on mode and project changes without changing the document", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("Worker", class { addEventListener() {} postMessage() {} terminate() {} });
  await builderDatabase.open();
  let editor!: ReturnType<typeof useBuilder>;
  function Harness() { editor = useBuilder(); return null; }
  root = createRoot(document.createElement("div"));
  await act(async () => root!.render(<Harness />));
  await act(async () => { await vi.waitFor(() => expect(editor.isReady).toBe(true)); });

  const inventory = parseInventory("part_id,color_id,quantity\n3022,5,1", "self-authored.csv");
  await act(async () => editor.replacePartsInventory(inventory, editor.document.id));
  const prepared: PreparedPart = { bottom: -0.4, part: {
    id: "plate", packageId: "test", ldrawId: "3022", name: "Plate 2 x 2", category: "", keywords: [], file: "parts/3022.dat",
  }, model: { version: 1, format: "ldr", sourceName: "placement.ldr", sourceText: "", originalBytes: [],
    steps: [], instances: [], resources: {}, legalDocuments: [] } };
  vi.mocked(prepareLibraryPart).mockResolvedValue(prepared);

  const beforePlacement = editor.document;
  const canUndoBeforePlacement = editor.canUndo;
  await act(async () => {
    await editor.selectInventoryPart({
      listId: inventory.id, rowId: inventory.rows[0].id, ldrawId: "3022", colorCode: "4",
    });
  });
  expect(editor.placementPreview).toBe(prepared);
  expect(editor.selectedInventory).not.toBeNull();
  expect(editor.document).toBe(beforePlacement);
  expect(editor.canUndo).toBe(canUndoBeforePlacement);

  act(() => editor.setToolMode("select"));
  expect(editor.placementPreview).toBeNull();
  expect(editor.selectedInventory).toBeNull();
  expect(editor.document).toBe(beforePlacement);
  expect(editor.canUndo).toBe(canUndoBeforePlacement);
  expect(allocatedCounts(editor.document).get(inventory.rows[0].id) ?? 0).toBe(0);

  await act(async () => { await editor.selectLibraryPart(prepared.part); });
  expect(editor.placementPreview).toBe(prepared);
  const nextProject = createEmptyDocument();
  await act(async () => { await editor.importProject(nextProject); });
  expect(editor.document.id).toBe(nextProject.id);
  expect(editor.placementPreview).toBeNull();
  expect(editor.selectedInventory).toBeNull();
});

it("does not restore delayed catalog or inventory previews after cancellation", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("Worker", class { addEventListener() {} postMessage() {} terminate() {} });
  await builderDatabase.open();
  let editor!: ReturnType<typeof useBuilder>;
  function Harness() { editor = useBuilder(); return null; }
  root = createRoot(document.createElement("div"));
  await act(async () => root!.render(<Harness />));
  await act(async () => { await vi.waitFor(() => expect(editor.isReady).toBe(true)); });

  const inventory = parseInventory("part_id,color_id,quantity\n3022,5,1", "self-authored.csv");
  const choice = { listId: inventory.id, rowId: inventory.rows[0].id, ldrawId: "3022", colorCode: "4" };
  const part: PreparedPart = { bottom: -0.4, part: {
    id: "plate", packageId: "test", ldrawId: "3022", name: "Plate 2 x 2", category: "", keywords: [], file: "parts/3022.dat",
  }, model: { version: 1, format: "ldr", sourceName: "placement.ldr", sourceText: "", originalBytes: [],
    steps: [], instances: [], resources: {}, legalDocuments: [] } };
  const scenarios = [
    { lookup: "catalog", change: "mode" },
    { lookup: "inventory", change: "mode" },
    { lookup: "catalog", change: "project" },
    { lookup: "inventory", change: "project" },
  ] as const;

  for (const { lookup, change } of scenarios) {
    await act(async () => editor.importProject(createEmptyDocument()));
    await act(async () => editor.setToolMode("view"));
    if (lookup === "inventory") {
      await act(async () => editor.replacePartsInventory(inventory, editor.document.id));
    }
    const before = editor.document;
    const canUndoBefore = editor.canUndo;
    let resolveGeometry!: (prepared: PreparedPart) => void;
    const delayedGeometry = new Promise<PreparedPart>(resolve => { resolveGeometry = resolve; });
    vi.mocked(prepareLibraryPart).mockImplementationOnce(() => delayedGeometry);

    let pending!: Promise<boolean>;
    await act(async () => {
      pending = lookup === "catalog"
        ? editor.selectLibraryPart(part.part)
        : editor.selectInventoryPart(choice);
    });
    expect(editor.partLoading).toBe(true);

    let nextProject: ReturnType<typeof createEmptyDocument> | undefined;
    if (change === "mode") {
      act(() => editor.setToolMode("select"));
      expect(editor.document).toBe(before);
      expect(editor.canUndo).toBe(canUndoBefore);
    } else {
      nextProject = createEmptyDocument();
      await act(async () => editor.importProject(nextProject!));
      expect(editor.document.id).toBe(nextProject.id);
      expect(editor.canUndo).toBe(false);
    }
    expect(editor.placementPreview).toBeNull();
    expect(editor.selectedInventory).toBeNull();
    expect(editor.partLoading).toBe(false);

    let result: boolean | undefined;
    await act(async () => {
      resolveGeometry(part);
      result = await pending;
    });
    expect(result).toBe(false);
    expect(editor.placementPreview).toBeNull();
    expect(editor.selectedInventory).toBeNull();
    expect(editor.partLoading).toBe(false);
    if (change === "mode") {
      expect(editor.document).toBe(before);
      expect(editor.canUndo).toBe(canUndoBefore);
      expect(allocatedCounts(editor.document).get(inventory.rows[0].id) ?? 0).toBe(0);
    } else {
      expect(editor.document.id).toBe(nextProject!.id);
      expect(editor.canUndo).toBe(false);
      const savedPrevious = await loadProject(before.id);
      expect(savedPrevious?.inventory).toEqual(before.inventory);
      expect(allocatedCounts(savedPrevious!).get(inventory.rows[0].id) ?? 0).toBe(0);
    }
  }
});

it("keeps the newer catalog part selected when an older lookup resolves last", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("Worker", class { addEventListener() {} postMessage() {} terminate() {} });
  await builderDatabase.open();
  let editor!: ReturnType<typeof useBuilder>;
  function Harness() { editor = useBuilder(); return null; }
  root = createRoot(document.createElement("div"));
  await act(async () => root!.render(<Harness />));
  await act(async () => { await vi.waitFor(() => expect(editor.isReady).toBe(true)); });

  const older: PreparedPart = {
    bottom: -0.4,
    part: { id: "older", packageId: "test", ldrawId: "3001", name: "Brick 2 x 4", category: "", keywords: [], file: "parts/3001.dat" },
    model: { version: 1, format: "ldr", sourceName: "older.ldr", sourceText: "", originalBytes: [],
      steps: [], instances: [], resources: {}, legalDocuments: [] },
  };
  const newer: PreparedPart = {
    bottom: -0.4,
    part: { id: "newer", packageId: "test", ldrawId: "3022", name: "Plate 2 x 2", category: "", keywords: [], file: "parts/3022.dat" },
    model: { version: 1, format: "ldr", sourceName: "newer.ldr", sourceText: "", originalBytes: [],
      steps: [], instances: [], resources: {}, legalDocuments: [] },
  };
  let resolveOlder!: (prepared: PreparedPart) => void;
  let resolveNewer!: (prepared: PreparedPart) => void;
  vi.mocked(prepareLibraryPart)
    .mockImplementationOnce(() => new Promise(resolve => { resolveOlder = resolve; }))
    .mockImplementationOnce(() => new Promise(resolve => { resolveNewer = resolve; }));

  let olderPending!: Promise<boolean>;
  let newerPending!: Promise<boolean>;
  await act(async () => { olderPending = editor.selectLibraryPart(older.part); });
  await act(async () => { newerPending = editor.selectLibraryPart(newer.part); });
  expect(editor.partLoading).toBe(true);

  let newerResult: boolean | undefined;
  await act(async () => {
    resolveNewer(newer);
    newerResult = await newerPending;
  });
  expect(newerResult).toBe(true);
  expect(editor.placementPreview).toBe(newer);

  let olderResult: boolean | undefined;
  await act(async () => {
    resolveOlder(older);
    olderResult = await olderPending;
  });
  expect(olderResult).toBe(false);
  expect(editor.placementPreview).toBe(newer);
  expect(editor.placementPreview?.part.id).toBe("newer");
  expect(editor.partLoading).toBe(false);
});

it("places a catalog 1x2 plate onto a 2x6 plate through the editor transaction", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("Worker", class { addEventListener() {} postMessage() {} terminate() {} });
  await builderDatabase.open();
  let editor!: ReturnType<typeof useBuilder>;
  function Harness() { editor = useBuilder(); return null; }
  root = createRoot(document.createElement("div"));
  await act(async () => root!.render(<Harness />));
  await act(async () => { await vi.waitFor(() => expect(editor.isReady).toBe(true)); });

  const resources = Object.fromEntries(["bricks", "plates"].flatMap(group =>
    JSON.parse(readFileSync(resolve(`public/parts/ldraw-${group}-2026-10-31.json`), "utf8")).files,
  ).map(file => [file.path, file])) as ImportedModel["resources"];
  const support = readFileSync(resolve("src/features/connections/fixtures/3795.dat"), "utf8");
  resources["parts/3795.dat"] = {
    ...resources["parts/3020.dat"], path: "parts/3795.dat", content: support,
  };
  const createModel = (sourceText: string): ImportedModel => {
    const imported: ImportedModel = {
      version: 1, format: "ldr", sourceName: "placement.ldr", sourceText,
      originalBytes: Array.from(new TextEncoder().encode(sourceText)), ...parseLDraw(sourceText),
      resources, legalDocuments: [],
    };
    imported.instances.forEach(instance => { instance.part.status = "resolved"; });
    return imported;
  };
  const base = createModel("1 16 0 -8 0 1 0 0 0 1 0 0 0 1 3795.dat\n");
  const plateModel = createModel("1 4 0 0 0 1 0 0 0 1 0 0 0 1 3023b.dat\n");
  const source = plateModel.instances[0];
  const prepared: PreparedPart = {
    part: { id: "catalog-3023b", packageId: "test", ldrawId: "3023b", name: "Plate 1 x 2",
      category: "Plates", keywords: [], file: "parts/3023b.dat" },
    model: plateModel,
    bottom: localPartBounds(plateModel, source.reference)
      .clone().applyMatrix4(worldMatrix(source.matrix)).min.y,
  };
  vi.mocked(prepareLibraryPart).mockResolvedValue(prepared);
  await act(async () => editor.importProject({ ...createEmptyDocument(), imported: base }));
  await act(async () => { await editor.selectLibraryPart(prepared.part); });
  expect(editor.placementPreview).toBe(prepared);
  await act(async () => editor.place({ x: 0.03, y: 0.4, z: 0.52 }));
  const placed = editor.imported!.instances[1];
  expect(placed.matrix).toEqual([1, 0, 0, 0, 0, 1, 0, -16, 0, 0, 1, 10]);
  expect(activeConnections(editor.imported!, placed.id)).toHaveLength(2);
  await act(async () => editor.undo());
  expect(editor.imported!.instances).toHaveLength(1);
  await act(async () => editor.redo());
  expect(activeConnections(editor.imported!, placed.id)).toHaveLength(2);
  await act(async () => editor.undo());
  // A latched preview is authoritative even if the raw finger left its center.
  await act(async () => editor.place({ x: 0.48, y: 0.6, z: 0.9 }, placed.matrix));
  expect(editor.imported!.instances[1].matrix).toEqual(placed.matrix);
  expect(activeConnections(editor.imported!, editor.imported!.instances[1].id)).toHaveLength(2);
});

it("clamps legacy saved bricks and allows fine steps without grid rounding", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("Worker", class { addEventListener() {} postMessage() {} terminate() {} });
  await builderDatabase.open();
  let editor!: ReturnType<typeof useBuilder>;
  function Harness() { editor = useBuilder(); return null; }
  root = createRoot(document.createElement("div"));
  await act(async () => root!.render(<Harness />));
  await act(async () => { await vi.waitFor(() => expect(editor.isReady).toBe(true)); });
  const legacyDocument = createEmptyDocument();
  legacyDocument.bricks = [{ id: "legacy", type: "brick-1x2", color: "#B40000", x: 0, y: 0, z: 0, rotation: 0 }];
  await act(async () => editor.importProject(legacyDocument));
  await act(async () => editor.select("legacy"));
  await act(async () => editor.setSelectedRotation(37.5));
  expect(editor.document.bricks[0].rotation).toBe(38);
  await act(async () => editor.undo());
  expect(editor.document.bricks[0].rotation).toBe(0);
  const before = editor.document;
  await act(async () => editor.changeHeight(-0.4));
  expect(editor.document).toBe(before);
  await act(async () => editor.nudgeSelected({ x: 0.05, y: 0.05, z: -0.05 }));
  expect(editor.document.bricks[0]).toMatchObject({ x: 0.05, y: 0.05, z: -0.05 });
  await act(async () => editor.changeHeight(-0.4));
  expect(editor.document.bricks[0].y).toBe(0);
});

it("tilts selected local bricks, preserves undo and keeps the real bottom above ground", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("Worker", class { addEventListener() {} postMessage() {} terminate() {} });
  await builderDatabase.open();
  let editor!: ReturnType<typeof useBuilder>;
  function Harness() { editor = useBuilder(); return null; }
  root = createRoot(document.createElement("div"));
  await act(async () => root!.render(<Harness />));
  await act(async () => { await vi.waitFor(() => expect(editor.isReady).toBe(true)); });
  const sourceDocument = createEmptyDocument();
  sourceDocument.bricks = [{ id: "tilt-me", type: "brick-2x4", color: "#B40000", x: 0, y: 0, z: 0, rotation: 0 }];
  await act(async () => editor.importProject(sourceDocument));
  await act(async () => editor.select("tilt-me"));
  await act(async () => editor.setSelectedTilt("x", 35));
  await act(async () => editor.setSelectedTilt("z", -20));

  const tilted = editor.document.bricks[0];
  expect(tilted).toMatchObject({ tiltX: 35, tiltZ: -20 });
  expect(brickBounds(tilted).min.y).toBeCloseTo(0);
  await act(async () => editor.undo());
  expect(editor.document.bricks[0]).toMatchObject({ tiltX: 35 });
  expect(editor.document.bricks[0].tiltZ).toBeUndefined();
  await act(async () => editor.redo());
  await act(async () => editor.changeHeight(-0.4));
  expect(brickBounds(editor.document.bricks[0]).min.y).toBeCloseTo(0);
  await act(async () => editor.save());
  expect((await loadProject(editor.document.id))!.bricks[0]).toEqual(editor.document.bricks[0]);
});

it("rotates local and imported selections with undo, redo, floor clamping, and saved angles", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("Worker", class { addEventListener() {} postMessage() {} terminate() {} });
  await builderDatabase.open();
  let editor!: ReturnType<typeof useBuilder>;
  function Harness() { editor = useBuilder(); return null; }
  root = createRoot(document.createElement("div"));
  await act(async () => root!.render(<Harness />));
  await act(async () => { await vi.waitFor(() => expect(editor.isReady).toBe(true)); });

  const sourceText = "0 Rotation test\n1 4 0 0 0 1 0 0 0 1 0 0 0 1 test.dat\n";
  const imported: ImportedModel = {
    version: 1, format: "ldr", sourceName: "rotation.ldr", sourceText,
    originalBytes: Array.from(new TextEncoder().encode(sourceText)), ...parseLDraw(sourceText),
    resources: { "parts/test.dat": { path: "parts/test.dat", author: "Fixture", license: "CC0-1.0",
      sourceUrl: "https://example.invalid/test.dat", content: "0 Test geometry\n3 16 0 0 0 20 0 0 0 20 0\n" } },
    legalDocuments: [],
  };
  imported.instances.forEach(instance => { instance.part.status = "resolved"; });
  const importedId = imported.instances[0].id;
  const importedFloor = stackingBounds(imported).get(importedId)!.min.y;
  const sourceDocument = createEmptyDocument();
  sourceDocument.bricks = [{ id: "local-rotation", type: "brick-2x4", color: "#B40000", x: 0, y: 0, z: 0, rotation: 0 }];
  sourceDocument.imported = imported;
  await act(async () => editor.importProject(sourceDocument));

  await act(async () => editor.select("local-rotation"));
  await act(async () => editor.setSelectedRotation(37.5));
  await act(async () => editor.setSelectedTilt("x", 35));
  await act(async () => editor.setSelectedTilt("z", -20));
  expect(editor.bricks[0]).toMatchObject({ rotation: 38, tiltX: 35, tiltZ: -20 });
  expect(brickBounds(editor.bricks[0]).min.y).toBeGreaterThanOrEqual(-1e-9);
  await act(async () => editor.rotateSelected());
  expect(editor.bricks[0].rotation).toBe(128);
  await act(async () => editor.undo());
  expect(editor.bricks[0].rotation).toBe(38);
  await act(async () => editor.redo());
  expect(editor.bricks[0].rotation).toBe(128);

  await act(async () => editor.select(importedId));
  await act(async () => editor.setSelectedRotation(47.25));
  await act(async () => editor.setSelectedTilt("x", 20));
  const edited = editor.imported!.instances.find(instance => instance.id === importedId)!;
  expect(edited).toMatchObject({ rotationY: 47, tiltX: 20 });
  expect(editor.imported!.sourceText).toBe(sourceText);
  expect(stackingBounds(editor.imported!).get(importedId)!.min.y).toBeGreaterThanOrEqual(importedFloor - 1e-9);
  const savedMatrix = [...edited.matrix];
  await act(async () => editor.undo());
  expect(editor.selectedInstance?.rotationY).toBe(47);
  expect(editor.selectedInstance?.tiltX).toBeUndefined();
  await act(async () => editor.redo());
  expect(editor.selectedInstance?.matrix).toEqual(savedMatrix);
  await act(async () => editor.save());
  expect((await loadProject(editor.document.id))!.imported!.instances.find(instance => instance.id === importedId))
    .toEqual(editor.selectedInstance);
});

it("applies one Y rotation to a selected local and imported group", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("Worker", class { addEventListener() {} postMessage() {} terminate() {} });
  await builderDatabase.open();
  let editor!: ReturnType<typeof useBuilder>;
  function Harness() { editor = useBuilder(); return null; }
  root = createRoot(document.createElement("div"));
  await act(async () => root!.render(<Harness />));
  await act(async () => { await vi.waitFor(() => expect(editor.isReady).toBe(true)); });

  const sourceText = "0 Group rotation test\n1 4 400 0 0 1 0 0 0 1 0 0 0 1 test.dat\n";
  const imported: ImportedModel = {
    version: 1, format: "ldr", sourceName: "group.ldr", sourceText,
    originalBytes: Array.from(new TextEncoder().encode(sourceText)), ...parseLDraw(sourceText),
    resources: { "parts/test.dat": { path: "parts/test.dat", author: "Fixture", license: "CC0-1.0",
      sourceUrl: "https://example.invalid/test.dat", content: "0 Test geometry\n3 16 0 0 0 20 0 0 0 20 0\n" } },
    legalDocuments: [],
  };
  imported.instances.forEach(instance => { instance.part.status = "resolved"; });
  const first = { id: "group-a", type: "brick-2x2" as const, color: "#B40000", x: 0, y: 0, z: 0, rotation: 0 };
  const second = { id: "group-b", type: "brick-1x2" as const, color: "#B40000", x: 10, y: 0, z: 0, rotation: 0 };
  const sourceDocument = { ...createEmptyDocument(), bricks: [first, second], imported };
  const importedId = imported.instances[0].id;
  await act(async () => editor.importProject(sourceDocument));
  await act(async () => editor.select(first.id));
  await act(async () => {
    editor.beginSelectedRotationEdit();
    editor.setSelectedRotation(45, [first.id, second.id, importedId]);
    editor.setSelectedRotation(90, [first.id, second.id, importedId]);
    expect(editor.canUndo).toBe(false);
    editor.endSelectedRotationEdit();
  });

  expect(editor.bricks.map(brick => [brick.x, brick.z, brick.rotation])).toEqual([
    [10, 10, 90], [10, 0, 90],
  ]);
  const changedInstance = editor.imported!.instances[0];
  expect(changedInstance.rotationY).toBe(90);
  expect(changedInstance.matrix[3] / 20).toBeCloseTo(10);
  expect(changedInstance.matrix[11] / 20).toBeCloseTo(-10);
  expect(editor.canUndo).toBe(true);
  await act(async () => editor.save());
  const saved = await loadProject(editor.document.id);
  expect(saved?.bricks).toEqual(editor.bricks);
  expect(saved?.imported?.instances[0]).toEqual(changedInstance);

  await act(async () => editor.undo());
  expect(editor.bricks).toEqual([first, second]);
  expect(editor.imported!.instances[0].matrix).toEqual(imported.instances[0].matrix);
  await act(async () => editor.redo());
  expect(editor.bricks.map(brick => brick.rotation)).toEqual([90, 90]);
  expect(editor.imported!.instances[0].rotationY).toBe(90);
});

it("moves a mixed selected group together as one saveable undo step", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("Worker", class { addEventListener() {} postMessage() {} terminate() {} });
  await builderDatabase.open();
  let editor!: ReturnType<typeof useBuilder>;
  function Harness() { editor = useBuilder(); return null; }
  root = createRoot(document.createElement("div"));
  await act(async () => { root!.render(<Harness />); });
  await act(async () => { await vi.waitFor(() => expect(editor.isReady).toBe(true)); });

  const sourceText = "0 Group move test\n1 4 400 0 0 0 0 1 0 1 0 -1 0 0 1 test.dat\n";
  const imported: ImportedModel = {
    version: 1, format: "ldr", sourceName: "group-move.ldr", sourceText,
    originalBytes: Array.from(new TextEncoder().encode(sourceText)), ...parseLDraw(sourceText),
    resources: { "parts/test.dat": { path: "parts/test.dat", author: "Fixture", license: "CC0-1.0",
      sourceUrl: "https://example.invalid/test.dat", content: "0 Test geometry\n3 16 0 0 0 20 0 0 0 20 0\n" } },
    legalDocuments: [],
  };
  imported.instances.forEach(instance => { instance.part.status = "resolved"; });
  const first = { id: "move-a", type: "brick-2x2" as const, color: "#B40000", x: 0, y: 0, z: 0, rotation: 37 };
  const second = { id: "move-b", type: "brick-1x2" as const, color: "#B40000", x: 10, y: 0, z: 0, rotation: 90 };
  const importedId = imported.instances[0].id;
  const before = { ...createEmptyDocument(), bricks: [first, second], imported };
  await act(async () => { await editor.importProject(before); });

  const originalMatrix = [...editor.imported!.instances[0].matrix];
  await act(async () => editor.moveGroup([first.id, second.id, importedId], { x: 2.5, y: 0.4, z: -1.5 }));
  expect(editor.bricks.map(brick => [brick.x, brick.y, brick.z, brick.rotation])).toEqual([
    [2.5, 0.4, -1.5, 37], [12.5, 0.4, -1.5, 90],
  ]);
  const moved = editor.imported!.instances[0];
  expect(moved.matrix[3] - originalMatrix[3]).toBe(50);
  expect(moved.matrix[7] - originalMatrix[7]).toBe(-8);
  expect(moved.matrix[11] - originalMatrix[11]).toBe(-30);
  for (const index of [0, 1, 2, 4, 5, 6, 8, 9, 10]) {
    expect(moved.matrix[index]).toBe(originalMatrix[index]);
  }
  expect(editor.canUndo).toBe(true);
  await act(async () => { await editor.save(); });
  expect((await loadProject(editor.document.id))?.bricks).toEqual(editor.bricks);
  expect((await loadProject(editor.document.id))?.imported?.instances[0]).toEqual(moved);

  await act(async () => editor.undo());
  expect(editor.bricks).toEqual([first, second]);
  expect(editor.imported!.instances[0].matrix).toEqual(originalMatrix);
  await act(async () => editor.redo());
  expect(editor.bricks.map(brick => [brick.x, brick.y, brick.z])).toEqual([
    [2.5, 0.4, -1.5], [12.5, 0.4, -1.5],
  ]);
  expect(editor.imported!.instances[0]).toEqual(moved);
});
