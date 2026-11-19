// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { useBuilder } from "../editor/useBuilder";
import { createEmptyDocument } from "../editor/model";
import { parseInventory } from "./import";
import { allocatedCounts } from "./accounting";
import { parseLDraw } from "../formats/ldraw/parser";
import { prepareLibraryPart, type PreparedPart } from "../editor/ldraw-editing";
import { resolveStoredInventory } from "../catalog/client";
import { builderDatabase } from "@/storage/database";
import InventoryPanel from "./InventoryPanel";
import { brickBounds } from "../editor/brick-transform";
import { stackingBounds } from "../engine/stacking";

vi.mock("../catalog/client", () => ({
  useCatalog: () => ({ status: "ready" }),
  ensureCatalog: async () => {},
  resolveStoredInventory: vi.fn(async (inventory: ReturnType<typeof parseInventory>) => ({
    inventory, resolutions: Object.fromEntries(inventory.rows.map(row => [row.id, {
      parts: [{ ldrawId: "test", name: "Synthetic test part" }],
      colors: [{ ldrawCode: "4", name: "Red", hex: "#B40000" }],
    }])),
  })),
}));
vi.mock("../editor/ldraw-editing", async importOriginal => ({
  ...await importOriginal<typeof import("../editor/ldraw-editing")>(),
  prepareLibraryPart: vi.fn(),
}));
let root: ReturnType<typeof createRoot> | undefined;
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  await builderDatabase.delete();
  vi.unstubAllGlobals(); vi.clearAllMocks();
});

it("handles loading, editable inventory colors, fast taps, stock, catalog exit and project switching", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("Worker", class { addEventListener() {} postMessage() {} terminate() {} });
  await builderDatabase.open();
  let editor!: ReturnType<typeof useBuilder>;
  function Harness() {
    editor = useBuilder();
    return <InventoryPanel document={editor.document} selected={editor.selectedInventory}
      onSelect={editor.selectInventoryPart} onSpread={editor.spreadInventoryParts}
      onReplace={editor.replacePartsInventory} onSelected={() => {}} />;
  }
  const container = document.createElement("div");
  root = createRoot(container);
  await act(async () => { root!.render(<Harness />); });
  await act(async () => { await vi.waitFor(() => expect(editor.isReady).toBe(true)); });
  const inventory = parseInventory("part_id,color_id,quantity\n3001,5,1", "self-authored.csv");
  await act(async () => editor.replacePartsInventory(inventory, editor.document.id));
  const choice = { listId: inventory.id, rowId: inventory.rows[0].id, ldrawId: "test", colorCode: "4" };
  const visibleRow = () => container.querySelector(`[data-testid="row-inventory-${choice.rowId}"]`);
  expect(visibleRow()).not.toBeNull();
  const part = { id: "test", packageId: "test", ldrawId: "test", name: "Synthetic", category: "", keywords: [], file: "parts/test.dat" };
  const prepared: PreparedPart = { part, bottom: -1, model: {
    version: 1, format: "ldr", sourceName: "synthetic.ldr", sourceText: "0 Synthetic", originalBytes: [],
    ...parseLDraw("1 4 0 0 0 1 0 0 0 1 0 0 0 1 test.dat"),
    resources: { "parts/test.dat": { path: "parts/test.dat", author: "Synthetic", sourceUrl: "https://example.invalid",
      license: "CC0-1.0", content: "0 Synthetic triangle\n3 16 0 0 0 20 0 0 0 20 0" } }, legalDocuments: [],
  } };
  prepared.model.instances[0].part.status = "resolved";
  vi.mocked(prepareLibraryPart).mockRejectedValueOnce(new Error("Geometry failed"));
  await act(async () => { expect(await editor.selectInventoryPart(choice)).toBe(false); });
  expect(editor.partError).toBe("Geometry failed");
  expect(allocatedCounts(editor.document).size).toBe(0);

  let finish!: (value: PreparedPart) => void;
  vi.mocked(prepareLibraryPart).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  let loading!: Promise<boolean>;
  await act(async () => { loading = editor.selectInventoryPart(choice); await Promise.resolve(); });
  await act(async () => { editor.cancelPartPreparation(); finish(prepared); expect(await loading).toBe(false); });
  expect(allocatedCounts(editor.document).size).toBe(0);
  expect(editor.selectedInventory).toBeNull();

  vi.mocked(prepareLibraryPart).mockResolvedValue(prepared);
  await act(async () => { expect(await editor.selectInventoryPart(choice)).toBe(true); });
  await act(async () => editor.setSelectedColor("#1E5AA8", "1"));
  await act(async () => { for (let i = 0; i < 10; i++) editor.place({ x: i, y: 0, z: 0 }); });
  expect(editor.brickCount).toBe(1);
  expect(editor.imported!.instances[0].colorCode).toBe("1");
  expect(allocatedCounts(editor.document).get(choice.rowId)).toBe(1);
  expect(visibleRow()).toBeNull();
  expect(container.textContent).toContain("Alle Teile dieser Liste sind verbaut");
  expect(editor.partError).toContain("aufgebraucht");
  await act(async () => editor.setSelectedColor("#FAC80A", "14"));
  expect(editor.imported!.instances[0].colorCode).toBe("14");
  await act(async () => editor.undo());
  expect(editor.imported!.instances[0].colorCode).toBe("1");
  await act(async () => editor.redo());
  expect(editor.imported!.instances[0].colorCode).toBe("14");
  expect(editor.document.inventory!.rows[0].colorId).toBe("5");
  expect(allocatedCounts(editor.document).get(choice.rowId)).toBe(1);
  await act(async () => editor.deleteSelected());
  expect(allocatedCounts(editor.document).size).toBe(0);
  expect(visibleRow()).not.toBeNull();
  await act(async () => editor.undo());
  expect(allocatedCounts(editor.document).get(choice.rowId)).toBe(1);
  expect(visibleRow()).toBeNull();
  await act(async () => editor.redo());
  expect(allocatedCounts(editor.document).size).toBe(0);
  expect(visibleRow()).not.toBeNull();
  await act(async () => editor.undo());
  await act(async () => { expect(await editor.selectLibraryPart(part)).toBe(true); });
  expect(editor.selectedInventory).toBeNull();
  await act(async () => editor.place({ x: 4, y: 0, z: 0 }));
  expect(editor.brickCount).toBe(2);
  expect(allocatedCounts(editor.document).get(choice.rowId)).toBe(1);
  expect(editor.imported!.instances[1].allocation).toBeUndefined();
  expect(visibleRow()).toBeNull();
  await act(async () => editor.deleteSelected());
  expect(allocatedCounts(editor.document).get(choice.rowId)).toBe(1);
  expect(visibleRow()).toBeNull();
  await act(async () => editor.undo());

  const firstId = editor.document.id;
  const staleChoice = { ...choice };
  await act(async () => editor.importProject(createEmptyDocument("Other project")));
  expect(editor.selectedInventory).toBeNull();
  await act(async () => { expect(await editor.selectInventoryPart(staleChoice)).toBe(false); });
  expect(editor.brickCount).toBe(0);
  await act(async () => { await editor.openProject(firstId); });
  expect(editor.brickCount).toBe(2);
  expect(editor.document.inventory).toEqual(inventory);
  expect(allocatedCounts(editor.document).get(choice.rowId)).toBe(1);
  expect(() => editor.replacePartsInventory(inventory, "old-project")).toThrow("gewechselt");
});

it("prepares inventory geometry before one undoable, separated bulk placement", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("Worker", class { addEventListener() {} postMessage() {} terminate() {} });
  await builderDatabase.open();
  vi.mocked(resolveStoredInventory).mockImplementation(async inventory => ({
    inventory,
    resolutions: Object.fromEntries(inventory.rows.map(row => [row.id, {
      parts: [{ ldrawId: row.partId === "3002" ? "test-two" : "test", name: "Synthetic" }],
      colors: [{ ldrawCode: "4", name: "Red", hex: "#B40000" }],
    }])),
  }));
  let editor!: ReturnType<typeof useBuilder>;
  function Harness() {
    editor = useBuilder();
    return <InventoryPanel document={editor.document} selected={editor.selectedInventory}
      onSelect={editor.selectInventoryPart} onSpread={editor.spreadInventoryParts}
      onReplace={editor.replacePartsInventory} onSelected={() => {}} />;
  }
  const container = document.createElement("div");
  root = createRoot(container);
  await act(async () => { root!.render(<Harness />); });
  await act(async () => { await vi.waitFor(() => expect(editor.isReady).toBe(true)); });
  const source = createEmptyDocument("Parts already on the surface");
  source.bricks.push({ id: "existing", type: "brick-2x4", color: "#B40000", x: 0, y: 0, z: 0, rotation: 0 });
  await act(async () => editor.importProject(source));
  const inventory = parseInventory("part_id,color_id,quantity\n3001,5,2\n3002,5,1", "batch.csv");
  await act(async () => editor.replacePartsInventory(inventory, editor.document.id));
  const requests = inventory.rows.map((row, index) => ({
    choice: { listId: inventory.id, rowId: row.id, ldrawId: index === 1 ? "test-two" : "test", colorCode: "4" },
    quantity: row.quantity,
  }));
  const part = { id: "test", packageId: "test", ldrawId: "test", name: "Synthetic", category: "", keywords: [], file: "parts/test.dat" };
  const prepared: PreparedPart = { part, bottom: -1, model: {
    version: 1, format: "ldr", sourceName: "synthetic.ldr", sourceText: "0 Synthetic", originalBytes: [],
    ...parseLDraw("1 4 0 0 0 1 0 0 0 1 0 0 0 1 test.dat"),
    resources: { "parts/test.dat": { path: "parts/test.dat", author: "Synthetic", sourceUrl: "https://example.invalid",
      license: "CC0-1.0", content: "0 Synthetic triangle\n3 16 0 0 0 20 0 0 0 20 0" } }, legalDocuments: [],
  } };
  prepared.model.instances[0].part.status = "resolved";
  const preparedTwo = structuredClone(prepared);
  preparedTwo.part = { ...part, id: "test-two", ldrawId: "test-two", file: "parts/test-two.dat" };
  preparedTwo.model.instances[0].reference = "test-two.dat";
  preparedTwo.model.instances[0].part.ldrawId = "test-two";
  delete preparedTwo.model.resources["parts/test.dat"];
  preparedTwo.model.resources["parts/test-two.dat"] = {
    ...prepared.model.resources["parts/test.dat"], path: "parts/test-two.dat",
  };

  vi.mocked(prepareLibraryPart).mockReset();
  vi.mocked(prepareLibraryPart).mockResolvedValueOnce(prepared).mockRejectedValueOnce(new Error("Geometry failed"));
  await act(async () => {
    await expect(editor.spreadInventoryParts(requests, () => {}, new AbortController().signal))
      .rejects.toThrow("Geometry failed");
  });
  expect(editor.document.imported).toBeUndefined();
  expect(allocatedCounts(editor.document).size).toBe(0);

  let finishPreparation!: (value: PreparedPart) => void;
  vi.mocked(prepareLibraryPart).mockReset();
  vi.mocked(prepareLibraryPart).mockImplementationOnce(() => new Promise(resolve => { finishPreparation = resolve; }));
  const controller = new AbortController();
  let cancelled!: Promise<{ placed: number; deferred: number }>;
  await act(async () => { cancelled = editor.spreadInventoryParts(requests, () => {}, controller.signal); });
  await vi.waitFor(() => expect(prepareLibraryPart).toHaveBeenCalledOnce(), { timeout: 15_000 });
  controller.abort();
  finishPreparation(prepared);
  await act(async () => {
    await expect(cancelled).rejects.toThrow(/abort/i);
  });
  expect(editor.document.imported).toBeUndefined();
  expect(allocatedCounts(editor.document).size).toBe(0);

  vi.mocked(prepareLibraryPart).mockReset();
  vi.mocked(prepareLibraryPart).mockResolvedValueOnce(prepared).mockResolvedValueOnce(preparedTwo);
  let result!: { placed: number; deferred: number };
  await act(async () => { result = await editor.spreadInventoryParts(requests, () => {}, new AbortController().signal); });
  expect(result).toEqual({ placed: 3, deferred: 0 });
  const imported = editor.document.imported!;
  expect(imported.instances).toHaveLength(3);
  expect(imported.instances.map(instance => instance.part.ldrawId)).toEqual(["test", "test", "test-two"]);
  expect(imported.instances.map(instance => instance.allocation?.rowId)).toEqual([
    inventory.rows[0].id, inventory.rows[0].id, inventory.rows[1].id,
  ]);
  expect(allocatedCounts(editor.document).get(inventory.rows[0].id)).toBe(2);
  const batchBounds = [...stackingBounds(imported).values()];
  const existingBounds = brickBounds(source.bricks[0]);
  for (const bounds of batchBounds) {
    expect(bounds.min.x).toBeGreaterThan(existingBounds.max.x);
    for (const other of batchBounds) {
      if (bounds === other) continue;
      expect(bounds.max.x <= other.min.x || other.max.x <= bounds.min.x ||
        bounds.max.z <= other.min.z || other.max.z <= bounds.min.z).toBe(true);
    }
  }

  await act(async () => editor.undo());
  expect(editor.document.imported).toBeUndefined();
  expect(editor.document.inventory).toEqual(inventory);
  await act(async () => editor.redo());
  expect(editor.document.imported!.instances).toHaveLength(3);

  editor.setToolMode("select");
  const selected = editor.document.imported!.instances[0];
  await act(async () => editor.select(selected.id));
  expect(editor.selectedId).toBe(selected.id);
  const beforeMove = [...editor.document.imported!.instances[0].matrix];
  await act(async () => editor.move(selected.id, { x: beforeMove[3] / 20 + 2, y: 0, z: beforeMove[11] / 20 }));
  expect(editor.document.imported!.instances[0].matrix[3]).not.toBe(beforeMove[3]);
  expect(editor.document.imported!.instances[0].allocation?.rowId).toBe(inventory.rows[0].id);
});
