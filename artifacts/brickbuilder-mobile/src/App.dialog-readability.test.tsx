// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import App from "./App";
import { I18nProvider, LANGUAGE_STORAGE_KEY } from "@/i18n/I18nProvider";
import { createEmptyDocument } from "@/features/editor/model";
import { parseInventory } from "@/features/inventory/import";
import { COLOR_THEME_STORAGE_KEY } from "@/platform/color-theme";
import { setRemoteGeometryEnabled } from "@/features/privacy/geometry-consent";
const premium = vi.hoisted(() => ({ active: false, status: "ready" }));
vi.mock("@/features/premium/usePremium", () => ({ usePremium: () => premium }));

const darkThemeCss = readFileSync("src/dark-theme.css", "utf8");
const editorCss = readFileSync("src/components/mobile/editor.css", "utf8");
const brandCss = readFileSync("src/brand-theme.css", "utf8");
const themeCss = readFileSync("src/index.css", "utf8");

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
    return <div data-testid="mock-canvas" data-construction-controls={String(props.showConstructionControls)}
      onPointerDown={() => props.onSelect?.(null)} />;
  },
}));
vi.mock("@/features/parts/PartsLibrary", () => ({ default: () => <div>Teilekatalog</div> }));
vi.mock("@/features/catalog/EvidencedColorPicker", () => ({
  default: (props: { onChange?: (color: { value: string; ldrawCode: string }) => void }) =>
    <button type="button" data-testid="mock-color-picker" onClick={() => props.onChange?.({ value: "#112233", ldrawCode: "1" })}>Farbauswahl</button>,
}));
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
let textScaleStyle: HTMLStyleElement | undefined;
let oldWidth: number;
let oldHeight: number;

afterEach(() => {
  premium.active = false; premium.status = "ready";
  if (root) act(() => root!.unmount());
  root = undefined;
  host?.remove();
  host = undefined;
  textScaleStyle?.remove();
  textScaleStyle = undefined;
  localStorage.clear();
  document.documentElement.classList.remove("dark");
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.clearAllMocks();
  canvasProps.current = {};
  Object.defineProperty(window, "innerWidth", { configurable: true, value: oldWidth });
  Object.defineProperty(window, "innerHeight", { configurable: true, value: oldHeight });
});

async function mount(
  theme: "light" | "dark",
  withSelection = false,
  language: "en" | "de" = "de",
  options: {
    viewport?: { width: number; height: number };
    projects?: { id: string; name: string; brickCount: number }[];
  } = {},
) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubEnv("VITE_NATIVE_ANDROID", "true");
  oldWidth = window.innerWidth;
  oldHeight = window.innerHeight;
  Object.defineProperty(window, "innerWidth", { configurable: true, value: options.viewport?.width ?? 390 });
  Object.defineProperty(window, "innerHeight", { configurable: true, value: options.viewport?.height ?? 844 });
  localStorage.setItem(COLOR_THEME_STORAGE_KEY, theme);
  localStorage.setItem(LANGUAGE_STORAGE_KEY, language);

  const document = createEmptyDocument("Mobile-Dialoge");
  if (withSelection) {
    document.bricks = [
      { id: "selected-brick", type: "brick-2x2", color: "#d75b3f", x: 0, y: 0, z: 0, rotation: 0 },
      { id: "second-brick", type: "brick-1x2", color: "#1e5aa8", x: 4, y: 0, z: 0, rotation: 0 },
    ];
  }
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
    projects: options.projects ?? [],
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
  await act(async () => root!.render(<I18nProvider><App /></I18nProvider>));
  expect(documentRef.documentElement.classList.contains("dark")).toBe(theme === "dark");
  expect(documentRef.documentElement.style.colorScheme).toBe(theme);
  return host;
}

const documentRef = globalThis.document;

function cssRule(css: string, selector: string) {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const matches = [...css.matchAll(new RegExp(`(?:^|\\n)\\s*${escapedSelector}\\s*\\{([^}]*)\\}`, "g"))];
  expect(matches.length, `Expected a CSS rule for ${selector}`).toBeGreaterThan(0);
  return matches.reduce<Record<string, string>>((declarations, match) => {
    for (const [, property, value] of match[1].matchAll(/([a-z-]+)\s*:\s*([^;]+);?/g)) {
      declarations[property] = value.trim();
    }
    return declarations;
  }, {});
}

it.each(["de", "en"] as const)("shows the language selector beside the theme button in %s", async language => {
  const container = await mount("light", false, language);
  const theme = container.querySelector<HTMLButtonElement>('[data-testid="button-toggle-theme"]')!;
  const languageButton = container.querySelector<HTMLButtonElement>('[data-testid="button-language-menu"]')!;
  expect(languageButton.getAttribute("aria-label")).toBe(language === "de" ? "Sprache" : "Language");
  expect(languageButton.getAttribute("aria-controls")).toBe("language-popover");
  const headerButtons = [...container.querySelectorAll<HTMLButtonElement>(".topbar-end > button, .topbar-end .language-menu > button")];
  expect(headerButtons.indexOf(languageButton)).toBe(headerButtons.indexOf(theme) + 1);
  expect(container.querySelector('[data-testid="select-language"]')).toBeNull();
  await act(async () => languageButton.click());
  const popup = documentRef.body.querySelector<HTMLElement>('[data-testid="select-language"]')?.closest('[role="dialog"]')!;
  expect(popup.id).toBe("language-popover");
  const select = popup.querySelector<HTMLSelectElement>('[data-testid="select-language"]')!;
  expect(select.getAttribute("aria-label")).toBe(language === "de" ? "Sprache" : "Language");

  await act(async () => container.querySelector<HTMLButtonElement>('[data-testid="button-project-menu"]')!.click());
  const menu = container.querySelector<HTMLElement>(".project-popover")!;
  expect(menu.querySelector(".popover-eyebrow")).toBeNull();
  for (const icon of menu.querySelectorAll(".popover-action svg")) {
    expect(icon.getAttribute("width")).toBe("20");
    expect(icon.getAttribute("aria-hidden")).toBe("true");
  }
  expect(menu.querySelector('[data-testid="select-language"]')).toBeNull();
  expect(editorCss).toMatch(/\.popover-action\s*\{[^}]*min-height: 48px/);
  expect(editorCss).toMatch(/\.popover-action\s*\{[^}]*font-size: 14px/);
  expect(editorCss).toContain(".language-popover");
  expect(brandCss).toContain("max-width: calc(100vw - 24px)");
});

it.each([
  { screen: "320px-wide screen", width: 320, height: 568 },
  { screen: "short landscape screen", width: 568, height: 320 },
])("keeps the project menu scrollable and within the screen at 200% text size on a $screen", async ({ width, height }) => {
  const lastProjectName = "Zuletzt gespeichertes Modell mit langem Namen";
  const container = await mount("light", false, "de", {
    viewport: { width, height },
    projects: Array.from({ length: 8 }, (_, index) => ({
      id: `saved-project-${index}`,
      name: index === 7 ? lastProjectName : `Gespeichertes Modell ${index + 1}`,
      brickCount: index + 1,
    })),
  });

  textScaleStyle = documentRef.createElement("style");
  textScaleStyle.textContent = "html { -webkit-text-size-adjust: 200%; text-size-adjust: 200%; }";
  documentRef.head.appendChild(textScaleStyle);
  await act(async () => container.querySelector<HTMLButtonElement>('[data-testid="button-project-menu"]')!.click());

  const menu = container.querySelector<HTMLElement>(".project-popover")!;
  const language = container.querySelector<HTMLSelectElement>('[data-testid="select-language"]');
  const lastProject = menu.querySelector<HTMLButtonElement>('[data-testid="button-open-project-saved-project-7"]')!;
  const menuSizing = cssRule(editorCss, ".project-popover");
  const brandSizing = cssRule(brandCss, ".project-popover");
  const savedProjectText = cssRule(editorCss, ".saved-project span");

  expect(textScaleStyle.textContent).toContain("text-size-adjust: 200%");
  expect(language).toBeNull();
  expect(lastProject.textContent).toContain(lastProjectName);
  expect(menuSizing.width).toBe("min(290px, calc(100vw - 28px))");
  expect(brandSizing["max-width"]).toBe("calc(100vw - 24px)");
  expect(brandSizing["max-height"]).toBe("min(76dvh, 680px)");
  expect(menuSizing["overflow-y"]).toBe("auto");
  expect(savedProjectText.overflow).toBe("hidden");
  expect(savedProjectText["text-overflow"]).toBe("ellipsis");
  expect(savedProjectText["white-space"]).toBe("nowrap");
});

it.each(["light", "dark"] as const)("uses real arrow and edge symbols in %s help", async theme => {
  const container = await mount(theme, true);
  await act(async () => container.querySelector<HTMLButtonElement>('[data-testid="button-gesture-help"]')!.click());
  const dialog = documentRef.body.querySelector<HTMLElement>('[data-testid="dialog-gesture-help"]')!;
  const edgeExample = dialog.querySelector(".thick-edges-sample")!;
  expect(edgeExample.outerHTML).toBe(container.querySelector('[data-testid="button-thick-edges"] .thick-edges-sample')!.outerHTML);
  const heightButtons = container.querySelectorAll<HTMLElement>(".mobile-selection-actions > button");
  expect(dialog.querySelector(".height-arrows")?.textContent).toBe(
    `${heightButtons[0]?.textContent} ${heightButtons[1]?.textContent}`,
  );
  expect(dialog.querySelector(".lucide-box, .lucide-panel-top, .lucide-folder-open")).toBeNull();
  const projects = dialog.querySelector(".gesture-guide-text-only")!;
  expect(projects.querySelector("svg")).toBeNull();
  expect(projects.textContent).toContain("Auf diesem Gerät");
});

it("uses logo orange rather than violet for secondary interface accents", () => {
  expect(brandCss).toContain("--brand-highlight: 27 95% 43%");
  expect(brandCss).toContain("--brand-highlight: 32 100% 64%");
  expect(themeCss).toContain("--secondary: 32 100% 92%");
  expect(themeCss).toContain("--secondary: 28 60% 28%");
  expect(themeCss).not.toMatch(/--(?:brand-highlight|secondary|chart-2):\s*(?:26[7-9]|27\d|28\d)\s/u);
});

it("switches to selection mode and selects a tapped part from the view canvas", async () => {
  await mount("light");
  const onViewPartTap = canvasProps.current.onViewPartTap as (id: string) => void;
  expect(onViewPartTap).toBeTypeOf("function");

  act(() => onViewPartTap("imported-part-17"));

  expect(editor.setToolMode).toHaveBeenCalledWith("select");
  expect(editor.select).toHaveBeenCalledWith("imported-part-17");
});

it("opens the English gesture guide from the header after theme and language", async () => {
  const container = await mount("light", false, "en");
  const headerButtons = [...container.querySelectorAll<HTMLButtonElement>(".topbar-end button")];
  const helpButton = container.querySelector<HTMLButtonElement>('[data-testid="button-gesture-help"]')!;
  expect(helpButton.getAttribute("aria-label")).toBe("Gesture help");
  expect(headerButtons.indexOf(helpButton)).toBe(headerButtons.indexOf(
    container.querySelector<HTMLButtonElement>('[data-testid="button-language-menu"]')!,
  ) + 1);
  expect(headerButtons.indexOf(container.querySelector<HTMLButtonElement>('[data-testid="button-save"]')!))
    .toBe(headerButtons.indexOf(helpButton) + 1);

  await act(async () => helpButton.click());
  const dialog = documentRef.body.querySelector<HTMLElement>('[data-testid="dialog-gesture-help"]')!;
  expect(dialog.textContent).toContain("App guide: modes, buttons, and gestures");
  expect(dialog.textContent).toContain("Build mode");
  expect(dialog.textContent).toContain("Double-tap empty space");
  expect(dialog.textContent).toContain("Double-tap a rotation or tilt slider");
  expect(dialog.textContent).toContain("Move connected upper parts");
  expect(dialog.textContent).toContain("Import file");
  expect(dialog.textContent).toContain("Android: the export can continue in the background or with the screen off for up to two hours.");
  expect(dialog.querySelectorAll(".gesture-guide-button-visual").length).toBeGreaterThan(20);
  expect(canvasProps.current.emptyDoubleTapZoomEnabled).toBe(false);
});

it("shows every mode's gesture help in German", async () => {
  const container = await mount("dark", false, "de");
  await act(async () => container.querySelector<HTMLButtonElement>('[data-testid="button-gesture-help"]')!.click());
  const dialog = documentRef.body.querySelector<HTMLElement>('[data-testid="dialog-gesture-help"]')!;

  expect(dialog.textContent).toContain("Hilfe: Modi, Schaltflächen und Gesten");
  expect(dialog.textContent).toContain("Ansichtsmodus");
  expect(dialog.textContent).toContain("Auswahlmodus");
  expect(dialog.textContent).toContain("Baumodus");
  expect(dialog.textContent).toContain("Löschmodus");
  expect(dialog.textContent).toContain("Doppeltipp auf freie Fläche");
  expect(dialog.textContent).toContain("Doppeltipp auf einen Dreh- oder Neigungsregler");
  expect(dialog.textContent).toContain("Verbundene obere Teile mitbewegen");
  expect(dialog.textContent).toContain("Datei importieren");
  expect(dialog.textContent).toContain("Android: Der Export kann bis zu zwei Stunden im Hintergrund oder bei ausgeschaltetem Bildschirm weiterlaufen.");
  expect(dialog.querySelectorAll(".gesture-guide-button-visual").length).toBeGreaterThan(20);
  expect(editorCss).toContain(".dark .gesture-guide-dialog");
});

it("cycles the edge control through off, thin, and thick, then persists off", async () => {
  localStorage.removeItem("brickbuilder-thick-edges");
  const container = await mount("light");
  const toggle = container.querySelector<HTMLButtonElement>('[data-testid="button-thick-edges"]')!;
  expect(toggle).not.toBeNull();
  expect(toggle.hidden).toBe(false);
  expect(toggle.textContent).toContain("Kanten");
  expect(toggle.dataset.edgeMode).toBe("off");
  expect(toggle.getAttribute("aria-pressed")).toBe("false");
  expect(toggle.getAttribute("aria-label")).toBe("Kanten aus");
  expect(canvasProps.current.edgeMode).toBe("off");

  act(() => toggle.click());
  expect(toggle.dataset.edgeMode).toBe("thin");
  expect(toggle.getAttribute("aria-pressed")).toBe("true");
  expect(toggle.textContent).toContain("Kanten");
  expect(toggle.getAttribute("aria-label")).toBe("Dünne Kanten");
  expect(canvasProps.current.edgeMode).toBe("thin");
  expect(localStorage.getItem("brickbuilder-thick-edges")).toBe("thin");

  act(() => toggle.click());
  expect(toggle.dataset.edgeMode).toBe("thick");
  expect(toggle.getAttribute("aria-pressed")).toBe("true");
  expect(toggle.getAttribute("aria-label")).toBe("Dicke Kanten");
  expect(canvasProps.current.edgeMode).toBe("thick");
  expect(localStorage.getItem("brickbuilder-thick-edges")).toBe("thick");

  act(() => toggle.click());
  expect(toggle.dataset.edgeMode).toBe("off");
  expect(toggle.getAttribute("aria-pressed")).toBe("false");
  expect(canvasProps.current.edgeMode).toBe("off");
  expect(localStorage.getItem("brickbuilder-thick-edges")).toBe("off");

  act(() => root!.unmount());
  root = undefined;
  host?.remove();
  host = undefined;
  const reopened = await mount("dark");
  expect(reopened.querySelector<HTMLButtonElement>('[data-testid="button-thick-edges"]')?.hidden).toBe(false);
  expect(canvasProps.current.edgeMode).toBe("off");
});

it("opens the existing rotation controls when the canvas reports a part double tap", async () => {
  const host = await mount("light", true);
  const openControls = canvasProps.current.onOpenRotationControls as (id: string) => void;
  expect(openControls).toBeTypeOf("function");

  act(() => openControls("selected-brick"));

  expect(editor.setToolMode).toHaveBeenCalledWith("select");
  expect(editor.select).toHaveBeenCalledWith("selected-brick");
  expect(host.querySelector<HTMLElement>('[data-testid="tilt-controls-menu"]')?.dataset.open).toBe("true");
});

it("opens the rotation panel with the selected imported part's current values", async () => {
  const host = await mount("light", true);
  editor.selectedInstance = {
    id: "selected-import",
    reference: "3001.dat",
    colorCode: "4",
    matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0],
    part: { ldrawId: "3001", status: "resolved" },
    rotationY: 90,
    tiltX: 12,
    tiltZ: -24,
  };
  await act(async () => root!.render(<I18nProvider><App /></I18nProvider>));
  const menu = host.querySelector<HTMLElement>('[data-testid="tilt-controls-menu"]')!;
  await act(async () => menu.querySelector<HTMLButtonElement>('[data-testid="button-tilt-controls"]')!.click());

  expect(documentRef.body.querySelector<HTMLInputElement>('[data-testid="slider-rotation-y"]')?.value).toBe("90");
  expect(documentRef.body.querySelector<HTMLInputElement>('[data-testid="slider-tilt-x"]')?.value).toBe("12");
  expect(documentRef.body.querySelector<HTMLInputElement>('[data-testid="slider-tilt-z"]')?.value).toBe("-24");
});

it("starts in English and switches the visible app labels to German", async () => {
  const container = await mount("light", false, "en");
  expect(container.textContent).toContain("View");
  await act(async () => container.querySelector<HTMLButtonElement>('[data-testid="button-language-menu"]')!.click());
  const language = container.querySelector<HTMLSelectElement>('[data-testid="select-language"]')!;
  expect(language.value).toBe("en");
  await act(async () => {
    language.value = "de";
    language.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(container.querySelector('[data-testid="select-language"]')).toBeNull();
  expect(documentRef.documentElement.lang).toBe("de");
  expect(container.textContent).toContain("Ansicht");
  expect(container.textContent).toContain("Bauen");
  expect(localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe("de");
});

it.each(["Escape", "outside click"] as const)("closes the language popup with %s", async dismissal => {
  const container = await mount("light");
  await act(async () => container.querySelector<HTMLButtonElement>('[data-testid="button-language-menu"]')!.click());
  expect(documentRef.body.querySelector('[data-testid="select-language"]')).not.toBeNull();
  await act(async () => {
    if (dismissal === "Escape") {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    } else {
      documentRef.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    }
  });
  expect(documentRef.body.querySelector('[data-testid="select-language"]')).toBeNull();
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
    const toggle = menu.querySelector<HTMLElement>(
      ".rotation-selection-toggle, .fine-position-toggle, .tilt-controls-toggle",
    )!;
    await act(async () => toggle!.click());
    expect(menu.dataset.open).toBe("true");
    expect(canvas.dataset.constructionControls).toBe("false");
    expect(canvasProps.current.emptyDoubleTapZoomEnabled).toBe(false);
    await act(async () => toggle!.click());
    expect(canvas.dataset.constructionControls).toBe("true");
    expect(canvasProps.current.emptyDoubleTapZoomEnabled).toBe(true);
  }
});

it("marks open mobile control menus and closes each one on an outside tap", async () => {
  const container = await mount("light", true);
  const menus = [
    { selector: '[data-testid="group-selection-menu"]', toggle: "button-group-selection" },
    { selector: '.mobile-selection-actions [data-testid="fine-position-menu"]', toggle: "button-fine-adjustment" },
    { selector: '.mobile-selection-actions [data-testid="tilt-controls-menu"]', toggle: "button-tilt-controls" },
  ];
  const outside = container.querySelector<HTMLElement>('[data-testid="mock-canvas"]')!;

  for (const item of menus) {
    const menu = container.querySelector<HTMLElement>(item.selector)!;
    const toggle = menu.querySelector<HTMLButtonElement>(`[data-testid="${item.toggle}"]`)!;
    await act(async () => toggle.click());
    expect(menu.dataset.open).toBe("true");
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(toggle.classList.contains("is-open")).toBe(true);

    await act(async () => outside.dispatchEvent(new Event("pointerdown", { bubbles: true })));
    expect(menu.dataset.open).toBe("false");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(toggle.classList.contains("is-open")).toBe(false);
  }
});

it("keeps multi-selection checkboxes in sync with viewport selection and applies color to all checked parts", async () => {
  const container = await mount("light", true);
  const menu = container.querySelector<HTMLElement>('[data-testid="group-selection-menu"]')!;
  await act(async () => menu.querySelector<HTMLButtonElement>('[data-testid="button-group-selection"]')!.click());

  const primary = container.querySelector<HTMLInputElement>('[data-testid="group-selection-item-selected-brick"] input')!;
  const secondary = container.querySelector<HTMLInputElement>('[data-testid="group-selection-item-second-brick"] input')!;
  expect(primary.checked).toBe(true);
  expect(secondary.checked).toBe(false);
  expect(container.textContent).toContain("Mehrfachauswahl");

  await act(async () => secondary.click());
  expect(secondary.checked).toBe(true);
  expect(canvasProps.current.selectedIds).toEqual(["selected-brick", "second-brick"]);
  expect(container.querySelector<HTMLInputElement>('[data-testid="group-selection-item-selected-brick"] input')!.checked).toBe(true);

  await act(async () => container.querySelector<HTMLButtonElement>('[data-testid="mobile-button-colors"]')!.click());
  const colorButton = documentRef.body.querySelector<HTMLButtonElement>('[data-testid="drawer-colors"] [data-testid="mock-color-picker"]')!;
  await act(async () => colorButton.click());
  expect(editor.setSelectedColor).toHaveBeenCalledWith("#112233", "1", ["selected-brick", "second-brick"]);
});

it("syncs direct viewport multi-selection into the opened multi-selection menu", async () => {
  const container = await mount("light", true);
  expect(canvasProps.current.selectedIds).toEqual(["selected-brick"]);

  await act(async () => canvasProps.current.onToggleSelection("second-brick"));
  expect(canvasProps.current.selectedIds).toEqual(["selected-brick", "second-brick"]);

  const menu = container.querySelector<HTMLElement>('[data-testid="group-selection-menu"]')!;
  await act(async () => menu.querySelector<HTMLButtonElement>('[data-testid="button-group-selection"]')!.click());
  expect(container.querySelector<HTMLInputElement>('[data-testid="group-selection-item-selected-brick"] input')!.checked).toBe(true);
  expect(container.querySelector<HTMLInputElement>('[data-testid="group-selection-item-second-brick"] input')!.checked).toBe(true);
});

it("preserves part selection on the tap that closes a menu and allows selection on the next tap", async () => {
  const container = await mount("light", true);
  const menu = container.querySelector<HTMLElement>('[data-testid="group-selection-menu"]')!;
  const toggle = menu.querySelector<HTMLButtonElement>('[data-testid="button-group-selection"]')!;
  const canvas = container.querySelector<HTMLElement>('[data-testid="mock-canvas"]')!;
  await act(async () => toggle.click());
  editor.select.mockClear();

  await act(async () => canvas.dispatchEvent(new Event("pointerdown", { bubbles: true })));

  expect(menu.dataset.open).toBe("false");
  expect(editor.select).not.toHaveBeenCalled();

  await act(async () => canvas.dispatchEvent(new Event("pointerdown", { bubbles: true })));
  expect(editor.select).toHaveBeenCalledOnce();
  expect(editor.select).toHaveBeenCalledWith(null);
});

it("keeps all three mobile panels open on a grip tap and moves them only after dragging", async () => {
  const container = await mount("light", true);
  const menus = [
    { selector: '[data-testid="group-selection-menu"]', toggle: "button-group-selection", grip: "button-move-group-panel-mobile", panel: ".rotation-selection-panel" },
    { selector: '.mobile-selection-actions [data-testid="fine-position-menu"]', toggle: "button-fine-adjustment", grip: "button-move-fine-panel", panel: ".fine-position-panel" },
    { selector: '.mobile-selection-actions [data-testid="tilt-controls-menu"]', toggle: "button-tilt-controls", grip: "button-move-tilt-panel", panel: ".tilt-panel" },
  ];
  for (const item of menus) {
    const menu = container.querySelector<HTMLElement>(item.selector)!;
    const toggle = menu.querySelector<HTMLButtonElement>(`[data-testid="${item.toggle}"]`)!;
    await act(async () => toggle.click());
    const panel = documentRef.body.querySelector<HTMLElement>(`${item.panel}.draggable-panel-portal`)!;
    const grip = panel.querySelector<HTMLElement>(`[data-testid="${item.grip}"]`)!;
    expect(panel).not.toBeNull();
    expect(panel.parentElement).toBe(documentRef.body);
    const pointer = (target: EventTarget, type: string, x: number, y: number) => {
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperties(event, { pointerId: { value: 3 }, pointerType: { value: "touch" }, clientX: { value: x }, clientY: { value: y } });
      target.dispatchEvent(event);
    };
    await act(async () => {
      pointer(grip, "pointerdown", 80, 80);
      pointer(window, "pointerup", 80, 80);
      grip.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(menu.dataset.open).toBe("true");
    expect(panel.classList.contains("is-positioned")).toBe(false);
    await act(async () => {
      pointer(grip, "pointerdown", 80, 80);
      pointer(window, "pointermove", 112, 118);
      pointer(window, "pointerup", 112, 118);
    });
    expect(menu.dataset.open).toBe("true");
    expect(panel.classList.contains("is-positioned")).toBe(true);
    expect(Number.parseFloat(panel.style.left)).toBeGreaterThan(8);
  }
});

function openProjectMenu(container: HTMLElement) {
  act(() => container.querySelector<HTMLButtonElement>('[data-testid="button-project-menu"]')!.click());
}

it("places the Premium purchase directly below privacy only for non-premium Android users", async () => {
  const container = await mount("light");
  openProjectMenu(container);
  const privacy = container.querySelector('[data-testid="button-open-privacy"]')!;
  const purchase = container.querySelector('[data-testid="button-open-premium"]')!;
  expect(privacy.nextElementSibling).toBe(purchase);
  expect(privacy.querySelector("svg")?.classList.contains("lucide-scale")).toBe(true);
  expect(purchase.querySelector("svg")?.classList.contains("lucide-star")).toBe(true);
  expect(purchase.textContent).toContain("Premium kaufen");
  premium.active = true;
  act(() => root!.render(<I18nProvider><App /></I18nProvider>));
  expect(container.querySelector('[data-testid="button-open-premium"]')).toBeNull();
  premium.active = false; premium.status = "loading";
  act(() => root!.render(<I18nProvider><App /></I18nProvider>));
  expect(container.querySelector('[data-testid="button-open-premium"]')).toBeNull();
  premium.status = "ready";
  vi.stubEnv("VITE_NATIVE_ANDROID", "false");
  act(() => root!.render(<I18nProvider><App /></I18nProvider>));
  expect(container.querySelector('[data-testid="button-open-premium"]')).toBeNull();
});

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
    expect(dialog.querySelector('[data-testid="warning-offline-import-incomplete"]')?.textContent)
      .toContain("Import kann unvollständig sein");
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
    expect(privacy.textContent).toContain("Datenschutzeinstellungen");
    expect(privacy.querySelector('input[type="checkbox"]')).not.toBeNull();
    expect(privacy.querySelector("iframe")?.title).toBe("Datenschutzerklärung");
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

it("hides the Android import completeness warning when online geometry is enabled", async () => {
  const container = await mount("light");
  expect(setRemoteGeometryEnabled(true)).toBe(true);

  openProjectMenu(container);
  act(() => container.querySelector<HTMLButtonElement>('[data-testid="button-open-export"]')!.click());
  const dialog = container.querySelector<HTMLElement>('[data-testid="dialog-formats"]')!;
  act(() => dialog.querySelector<HTMLButtonElement>('[data-testid="tab-format-import"]')!.click());

  expect(dialog.querySelector('[data-testid="warning-offline-import-incomplete"]')).toBeNull();
});

it("shows the Android import warning in English too", async () => {
  const container = await mount("light", false, "en");

  openProjectMenu(container);
  act(() => container.querySelector<HTMLButtonElement>('[data-testid="button-open-export"]')!.click());
  const dialog = container.querySelector<HTMLElement>('[data-testid="dialog-formats"]')!;
  act(() => dialog.querySelector<HTMLButtonElement>('[data-testid="tab-format-import"]')!.click());

  expect(dialog.querySelector('[data-testid="warning-offline-import-incomplete"]')?.textContent)
    .toContain("The import may be incomplete");
});

it("keeps dark inventory errors and storage details on readable theme tokens", () => {
  expect(darkThemeCss).toMatch(/\.dark \.inv-panel :is\(\.inv-error, \.inv-issue, \.inv-problems\)[\s\S]*?color:\s*hsl\(8 80% 82%\)/);
  expect(darkThemeCss).toMatch(/\.dark \.inv-panel :is\(\.inv-note, \.inv-template code\)[\s\S]*?color:\s*hsl\(var\(--foreground\)\)/);
  expect(darkThemeCss).toMatch(/\.dark \.sm-drawer :is\(\.sm-gauge p, \.sm-note, \.sm-row-copy small/);
  expect(darkThemeCss).toMatch(/\.dark \.sm-drawer \.sm-notice[\s\S]*?color:\s*hsl\(150 32% 82%\)/);
  expect(darkThemeCss).toMatch(/\.dark \.fmt-drawer :is\(input, select, textarea\)[\s\S]*?color:\s*hsl\(var\(--foreground\)\)/);
});

it("outlines color circles in dark mode", () => {
  expect(darkThemeCss).toMatch(/\.dark \.swatch\s*\{\s*border:\s*1px solid rgba\(255,\s*255,\s*255,\s*\.82\)/);
  expect(darkThemeCss).toMatch(/\.dark \.mobile-color-option > span:first-child,\s*\.dark \.dock-color-dot\s*\{[\s\S]*?border:\s*1px solid rgba\(255,\s*255,\s*255,\s*\.82\)/);
});
