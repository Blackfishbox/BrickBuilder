// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { Capacitor } from "@capacitor/core";
import { createEmptyDocument } from "@/features/editor/model";
import FormatDialog from "../FormatDialog";
import { BrickLinkExportError } from "./export";
const { exporter, importer } = vi.hoisted(() => ({ exporter: vi.fn(), importer: vi.fn() }));
vi.mock("../adapters", () => ({ exportModel: exporter, importModelFile: importer, validateImportFile: vi.fn() }));
vi.mock("../../catalog/CatalogPanel", () => ({ default: () => null }));
let root: ReturnType<typeof createRoot> | undefined;
let host: HTMLDivElement;
afterEach(() => {
  if (root) act(() => root!.unmount());
  root = undefined; host?.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers();
});
function open(
  initialMode: 'import' | 'export' = 'import',
  document = createEmptyDocument(),
  onImport = vi.fn(),
) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = window.document.createElement("div"); window.document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(<FormatDialog document={document} initialMode={initialMode} onClose={vi.fn()} onImport={onImport} />));
  return document;
}
it("exports the current document through the existing file download action", async () => {
  vi.useFakeTimers();
  vi.spyOn(Capacitor, "isNativePlatform").mockReturnValue(false);
  const create = vi.fn(() => "blob:parts-list"), revoke = vi.fn();
  vi.stubGlobal("URL", class extends URL { static createObjectURL = create; static revokeObjectURL = revoke; });
  const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  exporter.mockResolvedValue({ bytes: new TextEncoder().encode("<INVENTORY/>"), filename: "model-bricklink.xml", mime: "application/xml" });
  const document = open('export');
  await act(async () => host.querySelector<HTMLButtonElement>('[data-testid="button-export-bricklink"]')!.click());
  expect(exporter).toHaveBeenCalledWith(document, "bricklink");
  expect(create, host.textContent ?? '').toHaveBeenCalledOnce(); expect(click).toHaveBeenCalledOnce();
  expect(host.textContent).toContain("BrickLink-XML erstellt");
  act(() => vi.runAllTimers()); expect(revoke).toHaveBeenCalledWith("blob:parts-list");
});
it("shows blocked part numbers, colors and quantities without downloading a partial file", async () => {
  exporter.mockRejectedValue(new BrickLinkExportError([
    { reference: "unknown.dat", color: "LDraw 4", quantity: 3, reason: "Teilenummer fehlt oder ist mehrdeutig" },
  ]));
  const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  open('export');
  await act(async () => host.querySelector<HTMLButtonElement>('[data-testid="button-export-bricklink"]')!.click());
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("Keine Datei erstellt");
  expect(host.querySelector('[data-testid="bricklink-export-issues"]')?.textContent).toContain("3× unknown.dat");
  expect(host.textContent).toContain("LDraw 4");
  expect(click).not.toHaveBeenCalled();
});

it("opens on the requested import or export action and switches between separate views", () => {
  open();
  const importTab = host.querySelector<HTMLButtonElement>('[data-testid="tab-format-import"]')!;
  const exportTab = host.querySelector<HTMLButtonElement>('[data-testid="tab-format-export"]')!;
  expect(importTab.getAttribute("aria-selected")).toBe("true");
  expect(host.querySelector('[data-testid="input-import-file"]')).not.toBeNull();
  expect(host.querySelector('[data-testid="button-export-io"]')).toBeNull();
  act(() => exportTab.click());
  expect(exportTab.getAttribute("aria-selected")).toBe("true");
  expect(host.querySelector('[data-testid="input-import-file"]')).toBeNull();
  expect(host.querySelector('[data-testid="button-export-io"]')).not.toBeNull();
  act(() => importTab.click());
  expect(host.querySelector('[data-testid="input-import-file"]')).not.toBeNull();
});

it("places project creation before the preview and omits the geometry retry button", async () => {
  const imported = {
    version: 1 as const, format: "ldr" as const, sourceName: "missing.ldr", originalBytes: [], sourceText: "",
    root: "main", sections: {}, instances: [{
      id: "missing-instance", reference: "99999.dat", colorCode: "4",
      matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0] as [number, number, number, number, number, number, number, number, number, number, number, number],
      sourcePath: [], part: { ldrawId: "99999", status: "missing" as const },
    }], issues: [], resources: {}, legalDocuments: [],
  };
  const preview = createEmptyDocument();
  preview.imported = imported;
  importer.mockResolvedValue(preview);
  const onImport = vi.fn().mockResolvedValue(undefined);
  open("import", createEmptyDocument(), onImport);
  const input = host.querySelector<HTMLInputElement>('[data-testid="input-import-file"]')!;
  Object.defineProperty(input, "files", { configurable: true, value: [new File(["model"], "model.ldr")] });
  await act(async () => {
    input.dispatchEvent(new Event("change", { bubbles: true }));
    await Promise.resolve();
  });

  const createButton = host.querySelector<HTMLButtonElement>('[data-testid="button-create-imported"]')!;
  const previewLabel = [...host.querySelectorAll(".fmt-label")].find(label => label.textContent === "Vorschau")!;
  expect(createButton).not.toBeNull();
  expect(Boolean(createButton.compareDocumentPosition(previewLabel) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
  expect(host.querySelector('[data-testid="button-retry-geometry"]')).toBeNull();
});

it("automatically creates a project when Android opens a Studio IO file", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = window.document.createElement("div"); window.document.body.appendChild(host);
  root = createRoot(host);
  const file = new File(["studio archive"], "opened-from-files.io");
  const imported = createEmptyDocument("Imported from Android");
  const onImport = vi.fn().mockResolvedValue(undefined);
  const onClose = vi.fn();
  importer.mockResolvedValue(imported);
  await act(async () => {
    root!.render(<FormatDialog document={createEmptyDocument()} initialFile={file}
      autoImportInitialFile onClose={onClose} onImport={onImport} />);
    await new Promise(resolve => setTimeout(resolve, 0));
  });
  expect(importer).toHaveBeenCalledWith(file, expect.objectContaining({ signal: expect.any(AbortSignal) }));
  expect(onImport).toHaveBeenCalledWith(imported);
  expect(onClose).toHaveBeenCalledOnce();
});
