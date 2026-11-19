// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { builderDatabase } from "@/storage/database";
import { createEmptyDocument } from "../editor/model";
import { parseInventory } from "./import";
import InventoryPanel from "./InventoryPanel";
import type { Inventory, InventoryResolution } from "./types";
import type { InstalledPackage, LibraryPart } from "../parts/types";
import { hashBytes } from "../formats/online-geometry";
import { OFFICIAL } from "@workspace/ldraw-source";

const mocks = vi.hoisted(() => ({
  resolve: vi.fn(),
  render: vi.fn((_model: unknown, color: string) => `data:image/png;base64,${color}`),
}));
vi.mock("../catalog/client", () => ({ resolveStoredInventory: mocks.resolve }));
// Exercise real local lookup, thumbnail queue and geometry preparation, without WebGL in jsdom.
vi.mock("../parts/thumbnails/render", () => ({ renderThumbnail: mocks.render }));

let root: ReturnType<typeof createRoot> | undefined;
let intersect: IntersectionObserverCallback;
let targets: Set<Element>;
const red = { ldrawCode: "4", name: "Red", hex: "#B40000" };
const blue = { ldrawCode: "1", name: "Blue", hex: "#1E5AA8" };
const part = (ldrawId: string): LibraryPart => ({
  id: `inventory-test:${ldrawId}`, packageId: "inventory-test", ldrawId,
  name: `Part ${ldrawId}`, file: `parts/${ldrawId}.dat`, category: "", keywords: [],
});
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("Worker", undefined);
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Unexpected network download"); }));
  targets = new Set();
  vi.stubGlobal("IntersectionObserver", class {
    constructor(callback: IntersectionObserverCallback) { intersect = callback; }
    observe(target: Element) { targets.add(target); }
    unobserve(target: Element) { targets.delete(target); }
    disconnect() { targets.clear(); }
  });
  mocks.render.mockClear();
  await builderDatabase.open();
  await builderDatabase.partPackages.put({ id: "inventory-test", version: "1", sha256: "fixture" } as InstalledPackage);
  await builderDatabase.libraryParts.bulkPut([part("3001"), part("3002")]);
  await builderDatabase.libraryFiles.bulkPut(["3001", "3002"].map(id => ({
    id: `inventory-test:parts/${id}.dat`, packageId: "inventory-test", path: `parts/${id}.dat`,
    content: id === "3001" ? "3 16 0 0 0 20 0 0 0 -20 0"
      : "1 16 0 0 0 1 0 0 0 1 0 0 0 1 absent.dat",
    author: "Synthetic fixture", license: "CC0-1.0" as const,
    sourceUrl: `https://library.ldraw.org/library/official/parts/${id}.dat`,
  })));
});
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  await builderDatabase.delete();
  vi.unstubAllGlobals();
});

async function mount(csv: string, resolution: (id: string, colorId: string) => InventoryResolution) {
  const document = createEmptyDocument("Inventory thumbnails");
  document.inventory = parseInventory(csv, "synthetic.csv");
  const selected = { listId: document.inventory.id, rowId: document.inventory.rows[0].id, ldrawId: "3001", colorCode: "1" };
  mocks.resolve.mockImplementation(async (inventory: Inventory) => ({
    inventory, resolutions: Object.fromEntries(inventory.rows.map(row => [row.id, resolution(row.partId, row.colorId)])),
  }));
  const host = window.document.createElement("div");
  root = createRoot(host);
  const onSelect = vi.fn(async () => true);
  const onSelected = vi.fn();
  const render = async () => {
    await act(async () => root!.render(<InventoryPanel document={document} selected={selected}
      onSelect={onSelect} onSpread={async () => ({ placed: 0, deferred: 0 })}
      onReplace={() => {}} onSelected={onSelected} />));
  };
  await render();
  return { host, document, selected, onSelect, onSelected, render };
}
async function showThumbnails(count: number) {
  await vi.waitFor(async () => {
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); });
    expect(targets.size).toBe(count);
  });
  await act(async () => {
    intersect([...targets].map(target => ({ target, isIntersecting: true } as IntersectionObserverEntry)), {} as IntersectionObserver);
  });
}
async function waitForImages(host: HTMLElement, count: number) {
  await vi.waitFor(async () => {
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); });
    expect(host.querySelectorAll("img"), host.querySelector('[role="img"]')?.getAttribute("title") ?? "").toHaveLength(count);
  });
}

it("uses each resolved row's own color independently of the selected construction color", async () => {
  const view = await mount("part_id,color_id,quantity\n3001,5,2\n3001,7,1", (_id, colorId) => ({
    parts: [{ ldrawId: "3001", name: "Brick" }], colors: [colorId === "5" ? red : blue],
  }));
  expect(view.host.querySelector("img")).toBeNull();
  await showThumbnails(2);
  await waitForImages(view.host, 2);
  const sources = [...view.host.querySelectorAll("img")].map(img => img.src);
  expect(sources).toEqual(["data:image/png;base64,4", "data:image/png;base64,1"]);
  view.selected.colorCode = "15";
  await view.render();
  expect([...view.host.querySelectorAll("img")].map(img => img.src)).toEqual(sources);
  expect(fetch).not.toHaveBeenCalled();
});

it("waits for explicit ambiguous choices and keeps selection intact", async () => {
  const view = await mount("part_id,color_id,quantity\n3001,5,2", () => ({
    parts: [{ ldrawId: "3001", name: "Brick" }, { ldrawId: "3002", name: "Alternative" }],
    colors: [red, blue],
  }));
  const button = view.host.querySelector(".inv-use") as HTMLButtonElement;
  expect(button.disabled).toBe(true);
  expect(view.host.querySelector('[role="img"]')).toBeNull();
  for (const [selector, value] of [[".inv-pick select", "3001"], [".inv-pick:last-of-type select", "1"]]) {
    await act(async () => {
      const select = view.host.querySelector(selector) as HTMLSelectElement;
      select.value = value;
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
  }
  await showThumbnails(1);
  await waitForImages(view.host, 1);
  expect(view.host.querySelector("img")!.src).toContain(",1");
  await act(async () => button.click());
  expect(view.onSelect).toHaveBeenCalledWith({
    listId: view.document.inventory!.id, rowId: view.document.inventory!.rows[0].id,
    ldrawId: "3001", colorCode: "1",
  });
  expect(view.onSelected).toHaveBeenCalledOnce();
  expect(view.host.textContent).toContain("Übrig 2");
  expect(fetch).not.toHaveBeenCalled();
});

it("keeps missing local parts and dependencies as honest selectable fallbacks offline", async () => {
  const view = await mount("part_id,color_id,quantity\n3002,5,1\n3003,5,1\n9999,5,1", id => ({
    parts: id === "9999" ? [] : [{ ldrawId: id, name: `Part ${id}` }], colors: [red],
  }));
  await showThumbnails(1);
  await vi.waitFor(async () => {
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); });
    expect(view.host.querySelectorAll('[aria-label="Vorschau nicht verfügbar"]')).toHaveLength(2);
  });
  expect(view.host.querySelector("img")).toBeNull();
  expect(view.host.textContent).toContain("kein LDraw-Teil bekannt");
  expect([...view.host.querySelectorAll<HTMLButtonElement>(".inv-use")].every(button => !button.disabled)).toBe(true);
  expect(mocks.render).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
});

it("shows newly acquired geometry without installing a package, then removes it when the cache is deleted", async () => {
  const view = await mount("part_id,color_id,quantity\n3003,5,1", () => ({
    parts: [{ ldrawId: "3003", name: "Downloaded brick with a very long name ".repeat(8) }], colors: [red],
  }));
  await vi.waitFor(async () => {
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); });
    expect(view.host.querySelector('[aria-label="Vorschau nicht verfügbar"]')).not.toBeNull();
  });
  const files = await Promise.all([
    ["parts/3003.dat", "1 16 0 0 0 1 0 0 0 1 0 0 0 1 child.dat"],
    ["parts/child.dat", "3 16 0 0 0 20 0 0 0 -20 0"],
  ].map(async ([path, geometry]) => {
    const content = `0 Synthetic thumbnail fixture\n0 Name: ${path.split("/").pop()}\n0 Author: Synthetic fixture\n0 !LICENSE Licensed under CC0 : see CAreadme.txt\n${geometry}\n`;
    const bytes = new TextEncoder().encode(content);
    return { path, content, author: "Synthetic fixture", license: "CC0-1.0" as const,
      sourceUrl: `${OFFICIAL}${path}`, byteLength: bytes.length, sha256: await hashBytes(bytes) };
  }));
  await act(async () => {
    await builderDatabase.geometrySnapshots.put({ version: 1, id: "new-inventory-thumbnail", createdAt: "2026-11-17",
      roots: ["3003.dat"], files, graph: { "parts/3003.dat": ["parts/child.dat"] }, legalDocuments: [] });
  });
  await vi.waitFor(async () => {
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); });
    expect(targets.size).toBe(1);
  });
  await showThumbnails(1);
  await waitForImages(view.host, 1);
  expect(view.host.querySelector("img")!.src).toContain(",4");
  expect(await builderDatabase.libraryParts.where("ldrawId").equals("3003").count()).toBe(0);
  expect(mocks.render.mock.calls.at(-1)![0]).toMatchObject({ resources: {
    "parts/3003.dat": { content: files[0].content }, "parts/child.dat": { content: files[1].content },
  } });
  expect(view.host.textContent).toContain("Downloaded brick with a very long name");
  await act(async () => { await builderDatabase.geometrySnapshots.delete("new-inventory-thumbnail"); });
  await vi.waitFor(async () => {
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); });
    expect(view.host.querySelector("img")).toBeNull();
  });
  expect(fetch).not.toHaveBeenCalled();
});
