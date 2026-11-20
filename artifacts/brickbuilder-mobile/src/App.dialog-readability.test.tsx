// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import App from "./App";
import { createEmptyDocument } from "@/features/editor/model";
import { parseInventory } from "@/features/inventory/import";
import { COLOR_THEME_STORAGE_KEY } from "@/platform/color-theme";

const darkThemeCss = readFileSync("src/dark-theme.css", "utf8");

const { editor, getStorageOverview, canvasProps } = vi.hoisted(() => ({
  editor: {} as Record<string, any>,
  getStorageOverview: vi.fn(),
  canvasProps: { current: {} as Record<string, any> },
}));

vi.mock("@/features/editor/useBuilder", () => ({ useBuilder: () => editor }));
vi.mock("@/features/catalog/client", () => ({
  useCatalog: () => ({ status: "ready" }),
  resolveStoredInventory: async (inventory: { rows: { id: string; partId: string; colorId: string }[] }) => ({
    inventory,
    resolutions: Object.fromEntries(inventory.rows.map(row => [row.id, {
      parts: [{ ldrawId: row.partId, name: `Teil ${row.partId}` }],
      colors: [{ ldrawCode: row.colorId, name: `Farbe ${row.colorId}`, hex: "#b40000" }],
    }])),
  }),
  previewInventory: vi.fn(),
}));
vi.mock("@/features/engine/BuilderCanvas", () => ({
  default: (props: { showConstructionControls?: boolean; [key: string]: any }) => {
    canvasProps.current = props;
    return <div data-testid="mock-canvas" data-construction-controls={String(props.showConstructionControls)} />;
  },
}));
vi.mock("@/features/parts/PartsLibrary", () => ({ default: () => <div>Teilekatalog</div> }));
vi.mock("@/features/catalog/EvidencedColorPicker", () => ({ default: () => <div>Farbauswahl</div> }));
vi.mock("@/features/inventory/InventoryThumbnail", () => ({ default: () => <div aria-hidden="true" /> }));
vi.mock("@/storage/management", () => ({
  getStorageOverview,
  removeGeometrySnapshot: vi.fn(),
  removeInstalledPackage: vi.fn(),
  removeStoredProject: vi.fn(),
}));
vi.mock("@/storage/database", () => ({ loadProject: vi.fn() }));

let root: Root | undefined;
let host: HTMLDivElement | undefined;
let oldWidth: number;
let oldHeight: number;

afterEach(() => {
  if (root) act(() => root!.unmount());
  root = undefined;
  host?.remove();
  host = undefined;
  localStorage.clear();
  document.documentElement.classList.remove("dark");
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.clearAllMocks();
  canvasProps.current = {};
  Object.defineProperty(window, "innerWidth", { configurable: true, value: oldWidth });
  Object.defineProperty(window, "innerHeight", { configurable: true, value: oldHeight });
});

async function mount(theme: "light" | "dark", withSelection = false) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubEnv("VITE_NATIVE_ANDROID", "true");
  oldWidth = window.innerWidth;
  oldHeight = window.innerHeight;
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 390 });
  Object.defineProperty(window, "innerHeight", { configurable: true, value: 844 });
  localStorage.setItem(COLOR_THEME_STORAGE_KEY, theme);

  const document = createEmptyDocument("Mobile-Dialoge");
  document.inventory = parseInventory("part_id,color_id,quantity\n3001,5,2", "mobile.csv");
  Object.assign(editor, {
    isReady: true,
    document,
    bricks: document.bricks,
    imported: undefined,
    selectedId: withSelection ? "selected-brick" : null,
    selectedInstance: null,
    selectedPart: null,
    selectedInventory: null,
    selectedType: "brick-2x4",
    selectedColor: "#d75b3f",
    selectedColorCode: "4",
    toolMode: withSelection ? "select" : "view",
    projectName: "Mobile-Dialoge",
    projects: [],
    brickCount: 0,
    canUndo: false,
    canRedo: false,
    isSaving: false,
    savedAt: null,
    saveError: "",
    partLoading: false,
    partError: "",
    cancelPartPreparation: vi.fn(),
    changeHeight: vi.fn(),
    deleteSelected: vi.fn(),
    importProject: vi.fn(),
    move: vi.fn(),
    nudgeSelected: vi.fn(),
    openProject: vi.fn(),
    place: vi.fn(),
    redo: vi.fn(),
    refreshProjects: vi.fn().mockResolvedValue([]),
    rotateSelected: vi.fn(),
    save: vi.fn(),
    select: vi.fn(),
    selectInventoryPart: vi.fn(),
    selectLibraryPart: vi.fn(),
    setInstructionPlan: vi.fn(),
    setProjectName: vi.fn(),
    setSelectedColor: vi.fn(),
    setToolMode: vi.fn(),
    startNewProject: vi.fn(),
    undo: vi.fn(),
    replacePartsInventory: vi.fn(),
  });
  getStorageOverview.mockResolvedValue({
    browser: { usage: 4096, quota: 8192 },
    projects: [
      { id: "current-project", name: "Geöffnetes Modell", bytes: 1024, detail: "1 Stein" },
      { id: "older-project", name: "Früheres Modell", bytes: 2048, detail: "2 Steine" },
    ],
    packages: [{ id: "parts-package", name: "Teilepaket", bytes: 512, detail: "1 Teil · 1 Datei" }],
    snapshots: [{ id: "snapshot", name: "3001.dat", bytes: 128, detail: "1 Datei" }],
  });

  host = documentRef.createElement("div");
  documentRef.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root!.render(<App />));
  expect(documentRef.documentElement.classList.contains("dark")).toBe(theme === "dark");
  expect(documentRef.documentElement.style.colorScheme).toBe(theme);
  return host;
}

const documentRef = globalThis.document;

it("switches to selection mode and selects a tapped part from the view canvas", async () => {
  await mount("light");
  const onViewPartTap = canvasProps.current.onViewPartTap as (id: string) => void;
  expect(onViewPartTap).toBeTypeOf("function");

  act(() => onViewPartTap("imported-part-17"));

  expect(editor.setToolMode).toHaveBeenCalledWith("select");
  expect(editor.select).toHaveBeenCalledWith("imported-part-17");
});

it("hides the canvas status controls for every open mobile selection menu", async () => {
  const container = await mount("light", true);
  const canvas = container.querySelector<HTMLElement>('[data-testid="mock-canvas"]')!;
  expect(canvas.dataset.constructionControls).toBe("true");

  for (const selector of [
    '[data-testid="group-selection-menu"]',
    '.mobile-selection-actions [data-testid="fine-position-menu"]',
    '.mobile-selection-actions [data-testid="tilt-controls-menu"]',
  ]) {
    const menu = container.querySelector<HTMLElement>(selector)!;
    const summary = menu.querySelector("summary")!;
    expect(summary.textContent?.trim()).toBe("");
    await act(async () => summary.click());
    expect(menu.matches("details[open]")).toBe(true);
    expect(canvas.dataset.constructionControls).toBe("false");
    await act(async () => summary.click());
    expect(canvas.dataset.constructionControls).toBe("true");
  }
});

function openProjectMenu(container: HTMLElement) {
  act(() => container.querySelector<HTMLButtonElement>('[data-testid="button-project-menu"]')!.click());
}

it.each(["light", "dark"] as const)(
  "opens the mobile format, storage, privacy and inventory surfaces in %s mode",
  async theme => {
    const container = await mount(theme);

    openProjectMenu(container);
    act(() => container.querySelector<HTMLButtonElement>('[data-testid="button-open-export"]')!.click());
    let dialog = container.querySelector<HTMLElement>('[data-testid="dialog-formats"]')!;
    expect(dialog.textContent).toContain("Datei exportieren");
    expect(dialog.querySelector('[data-testid="button-export-json"]')).not.toBeNull();
    expect(dialog.querySelector('[data-testid="button-export-bricklink"]')).not.toBeNull();
    act(() => dialog.querySelector<HTMLButtonElement>('[data-testid="tab-format-import"]')!.click());
    expect(dialog.querySelector<HTMLInputElement>('[data-testid="input-import-file"]')).not.toBeNull();
    act(() => dialog.querySelector<HTMLButtonElement>('[data-testid="button-close-formats"]')!.click());

    openProjectMenu(container);
    act(() => container.querySelector<HTMLButtonElement>('[data-testid="button-open-storage"]')!.click());
    await act(async () => { await Promise.resolve(); });
    dialog = document.body.querySelector<HTMLElement>('[data-testid="dialog-storage"]')!;
    expect(dialog.textContent).toContain("Browser-Speicher dieser Website");
    expect(dialog.textContent).toContain("Früheres Modell");
    expect(dialog.querySelector('[data-testid="button-delete-project-older-project"]')).not.toBeNull();
    expect(dialog.querySelector('[data-testid="button-remove-package-parts-package"]')).not.toBeNull();
    act(() => dialog.querySelector<HTMLButtonElement>('[data-testid="button-delete-project-older-project"]')!.click());
    expect(document.body.querySelector('[data-testid="dialog-confirm-storage"]')?.textContent).toContain("nicht rückgängig gemacht");
    expect(document.body.querySelector('[data-testid="button-cancel-storage-action"]')).not.toBeNull();
    act(() => document.body.querySelector<HTMLButtonElement>('[data-testid="button-cancel-storage-action"]')!.click());
    act(() => dialog.querySelector<HTMLButtonElement>('[data-testid="button-close-storage"]')!.click());

    openProjectMenu(container);
    act(() => container.querySelector<HTMLButtonElement>('[data-testid="button-open-privacy"]')!.click());
    const privacy = document.body.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(privacy.textContent).toContain("Datenschutz · Android-Fassung");
    expect(privacy.querySelector('input[type="checkbox"]')).not.toBeNull();
    expect(privacy.querySelector("iframe")?.title).toBe("Datenschutzerklärung für BrickBuilder Mobile");
    act(() => privacy.querySelector<HTMLButtonElement>("button")!.click());

    act(() => container.querySelector<HTMLButtonElement>('[data-testid="mobile-button-parts"]')!.click());
    const parts = container.querySelector<HTMLElement>('[data-testid="drawer-parts"]')!;
    await act(async () => {
      parts.querySelector<HTMLButtonElement>('[data-testid="tab-inventory"]')!.click();
      await Promise.resolve();
    });
    const inventory = parts.querySelector<HTMLElement>('[data-testid="panel-inventory"]')!;
    expect(inventory.textContent).toContain("mobile.csv");
    expect(inventory.textContent).toContain("CSV-Vorlage");
    expect(inventory.querySelector('[data-testid="input-inventory-file"]')).not.toBeNull();
    expect(inventory.querySelector('[data-testid="input-inventory-search"]')).not.toBeNull();
    expect(inventory.querySelector('[data-testid^="button-inventory-use-"]')).not.toBeNull();
    expect(parts.querySelector('[data-testid="tab-inventory"]')?.getAttribute("aria-selected")).toBe("true");
  },
);

it("keeps dark inventory errors and storage details on readable theme tokens", () => {
  expect(darkThemeCss).toMatch(/\.dark \.inv-panel :is\(\.inv-error, \.inv-issue, \.inv-problems\)[\s\S]*?color:\s*hsl\(8 80% 82%\)/);
  expect(darkThemeCss).toMatch(/\.dark \.inv-panel :is\(\.inv-note, \.inv-template code\)[\s\S]*?color:\s*hsl\(var\(--foreground\)\)/);
  expect(darkThemeCss).toMatch(/\.dark \.sm-drawer :is\(\.sm-gauge p, \.sm-note, \.sm-row-copy small/);
  expect(darkThemeCss).toMatch(/\.dark \.sm-drawer \.sm-notice[\s\S]*?color:\s*hsl\(150 32% 82%\)/);
  expect(darkThemeCss).toMatch(/\.dark \.fmt-drawer :is\(input, select, textarea\)[\s\S]*?color:\s*hsl\(var\(--foreground\)\)/);
});
