// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import InventoryPanel from "./InventoryPanel";
import { createEmptyDocument, type BuilderDocument } from "../editor/model";
import { parseInventory } from "./import";
import { parseLDraw } from "../formats/ldraw/parser";
import type { Inventory } from "./types";
import { previewInventory, resolveStoredInventory } from "../catalog/client";

vi.mock("../catalog/client", () => ({
  previewInventory: vi.fn(),
  resolveStoredInventory: async (inventory: Inventory) => ({
    inventory, resolutions: Object.fromEntries(inventory.rows.map(row => [row.id, {
      parts: row.partId === "ambiguous"
        ? [{ ldrawId: "part-a", name: "Part A" }, { ldrawId: "part-b", name: "Part B" }]
        : row.partId === "unknown" ? [] : [{ ldrawId: row.partId, name: `Part ${row.partId}` }],
      colors: [{ ldrawCode: "4", name: "Red", hex: "#B40000" }],
    }])),
  }),
}));
let root: ReturnType<typeof createRoot> | undefined;
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  vi.unstubAllGlobals();
});
function fixture(count: number) {
  const document = createEmptyDocument("Inventory visibility");
  document.inventory = parseInventory("part_id,color_id,quantity\n" +
    Array.from({ length: count }, (_, i) => `${3000 + i},5,1`).join("\n"), "synthetic.csv");
  return document;
}
function consume(document: BuilderDocument, indexes: number[]) {
  const parsed = parseLDraw(indexes.map(() => "1 4 0 0 0 1 0 0 0 1 0 0 0 1 test.dat").join("\n"));
  parsed.instances.forEach((instance, i) => {
    instance.allocation = { listId: document.inventory!.id, rowId: document.inventory!.rows[indexes[i]].id };
  });
  return { ...document, imported: {
    version: 1 as const, format: "ldr" as const, sourceName: "synthetic.ldr", originalBytes: [], sourceText: "",
    ...parsed, resources: {}, legalDocuments: [],
  } };
}
async function panel(onSpread = vi.fn(async () => ({ placed: 0, deferred: 0 })), onReplace = vi.fn()) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = window.document.createElement("div");
  root = createRoot(container);
  return {
    container,
    render: async (document: BuilderDocument) => {
      await act(async () => root!.render(<InventoryPanel document={document} selected={null}
        onSelect={async () => true} onSpread={onSpread}
        onReplace={onReplace} onSelected={() => {}} />));
    },
    onSpread,
    onReplace,
  };
}
it("filters exhausted rows before pagination and retains partially available rows", async () => {
  const document = fixture(33);
  document.inventory!.rows[30].quantity = 2;
  const view = await panel();
  await view.render(consume(document, Array.from({ length: 31 }, (_, i) => i)));
  expect(view.container.querySelectorAll(".inv-row")).toHaveLength(3);
  expect(view.container.querySelector(".inv-pager")).toBeNull();
  expect(view.container.querySelector(`[data-testid="row-inventory-${document.inventory!.rows[30].id}"]`)?.textContent).toContain("Übrig 1");
  await view.render(consume(document, Array.from({ length: 29 }, (_, i) => i + 1)));
  expect(view.container.querySelector(`[data-testid="row-inventory-${document.inventory!.rows[0].id}"]`)).not.toBeNull();
});

async function upload(container: HTMLElement) {
  const input = container.querySelector('[data-testid="input-inventory-file"]') as HTMLInputElement;
  Object.defineProperty(input, "files", { configurable: true, value: [new File(["<INVENTORY/>"], "parts.xml")] });
  await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
}

it("shows import errors with the filename and lets the user retry without losing the old list", async () => {
  const doc = fixture(1);
  vi.mocked(previewInventory).mockRejectedValueOnce(new Error("Katalog offline."));
  const view = await panel();
  await view.render(doc);
  await upload(view.container);
  expect(view.container.querySelector('[role="alert"]')?.textContent).toContain("parts.xml");
  expect(view.container.textContent).toContain("Katalog offline.");
  expect(view.onReplace).not.toHaveBeenCalled();
  expect(view.container.querySelectorAll(".inv-row")).toHaveLength(1);
});

it("shows a preview and explicit success for a 213-position wanted list", async () => {
  const doc = fixture(213);
  doc.inventory!.rows[0].quantity = 592; // 804 pieces in total.
  vi.mocked(previewInventory).mockResolvedValueOnce(await resolveStoredInventory(doc.inventory!));
  const view = await panel();
  await view.render(createEmptyDocument());
  await upload(view.container);
  expect(view.container.querySelector('[data-testid="inventory-preview"]')?.textContent).toContain("804");
  const preview = view.container.querySelector('[data-testid="inventory-preview"]')!;
  expect([...preview.children].indexOf(preview.querySelector('.inv-actions')!))
    .toBeLessThan([...preview.children].indexOf(preview.querySelector('.inv-preview-rows')!));
  await act(async () => (view.container.querySelector('[data-testid="button-inventory-preview-confirm"]') as HTMLButtonElement).click());
  expect(view.onReplace).toHaveBeenCalledWith(doc.inventory, expect.any(String));
  expect(view.container.textContent).toContain("213 Positionen mit 804 Teilen übernommen");
});

it("turns a stalled import into an actionable error and ignores late results", async () => {
  const preview = await resolveStoredInventory(fixture(1).inventory!);
  let finish!: (value: typeof preview) => void;
  vi.mocked(previewInventory).mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  const view = await panel();
  await view.render(createEmptyDocument());
  vi.useFakeTimers();
  try {
    await upload(view.container);
    await act(async () => vi.advanceTimersByTimeAsync(90_000));
    expect(view.container.querySelector('[role="alert"]')?.textContent).toContain("90 Sekunden");
    await act(async () => finish(preview));
    expect(view.container.querySelector('[data-testid="inventory-preview"]')).toBeNull();
    expect(view.onReplace).not.toHaveBeenCalled();
  } finally {
    vi.useRealTimers();
  }
});
it("clamps the page when stock shrinks and does not jump back after a deleted part returns", async () => {
  const document = fixture(31);
  const view = await panel();
  await view.render(document);
  await act(async () => (view.container.querySelector('[data-testid="button-inventory-next"]') as HTMLButtonElement).click());
  expect(view.container.textContent).toContain("Seite 2 / 2");
  await view.render(consume(document, [30]));
  expect(view.container.querySelectorAll(".inv-row")).toHaveLength(30);
  expect(view.container.querySelector(".inv-pager")).toBeNull();
  await view.render(document);
  expect(view.container.textContent).toContain("Seite 1 / 2");
  await act(async () => (view.container.querySelector('[data-testid="button-inventory-next"]') as HTMLButtonElement).click());
  expect(view.container.querySelector(`[data-testid="row-inventory-${document.inventory!.rows[30].id}"]`)).not.toBeNull();
});

it("offers bulk distribution for remaining stock and excludes ambiguous or unresolved rows", async () => {
  const document = fixture(3);
  document.inventory!.rows[0].partId = "ambiguous";
  document.inventory!.rows[0].quantity = 3;
  document.inventory!.rows[1].partId = "unknown";
  document.inventory!.rows[2].quantity = 2;
  const consumed = consume(document, [2]);
  const onSpread = vi.fn(async () => ({ placed: 1, deferred: 0 }));
  const view = await panel(onSpread);
  await view.render(consumed);
  expect(view.container.querySelector('[data-testid="status-inventory-spread-issues"]')?.textContent)
    .toContain("mehrdeutiges Teil braucht eine Auswahl");
  expect(view.container.querySelector('[data-testid="status-inventory-spread-issues"]')?.textContent)
    .toContain("kein belegtes LDraw-Teil");
  const button = view.container.querySelector('[data-testid="button-inventory-spread"]') as HTMLButtonElement;
  expect(button.textContent).toContain("(1)");
  await act(async () => button.click());
  expect(onSpread).toHaveBeenCalledWith([
    { choice: { listId: consumed.inventory!.id, rowId: consumed.inventory!.rows[2].id, ldrawId: "3002", colorCode: "4" }, quantity: 1 },
  ], expect.any(Function), expect.any(AbortSignal));
  expect(view.container.querySelector('[data-testid="status-inventory-spread-result"]')?.textContent)
    .toContain("1 Teile auf der Baufläche verteilt");
});
