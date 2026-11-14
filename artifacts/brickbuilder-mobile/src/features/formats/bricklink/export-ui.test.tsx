// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { createEmptyDocument } from "@/features/editor/model";
import FormatDialog from "../FormatDialog";
import { BrickLinkExportError } from "./export";
const { exporter } = vi.hoisted(() => ({ exporter: vi.fn() }));
vi.mock("../adapters", () => ({ exportModel: exporter, importModelFile: vi.fn(), validateImportFile: vi.fn() }));
vi.mock("../../catalog/CatalogPanel", () => ({ default: () => null }));
let root: ReturnType<typeof createRoot> | undefined;
let host: HTMLDivElement;
afterEach(() => {
  if (root) act(() => root!.unmount());
  root = undefined; host?.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers();
});
function open() {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const document = createEmptyDocument();
  host = window.document.createElement("div"); window.document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(<FormatDialog document={document} onClose={vi.fn()} onImport={vi.fn()} />));
  return document;
}
it("exports the current document through the existing file download action", async () => {
  vi.useFakeTimers();
  const create = vi.fn(() => "blob:parts-list"), revoke = vi.fn();
  vi.stubGlobal("URL", class extends URL { static createObjectURL = create; static revokeObjectURL = revoke; });
  const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  exporter.mockResolvedValue({ bytes: new TextEncoder().encode("<INVENTORY/>"), filename: "model-bricklink.xml", mime: "application/xml" });
  const document = open();
  await act(async () => host.querySelector<HTMLButtonElement>('[data-testid="button-export-bricklink"]')!.click());
  expect(exporter).toHaveBeenCalledWith(document, "bricklink");
  expect(create).toHaveBeenCalledOnce(); expect(click).toHaveBeenCalledOnce();
  expect(host.textContent).toContain("BrickLink-XML erstellt");
  act(() => vi.runAllTimers()); expect(revoke).toHaveBeenCalledWith("blob:parts-list");
});
it("shows blocked part numbers, colors and quantities without downloading a partial file", async () => {
  exporter.mockRejectedValue(new BrickLinkExportError([
    { reference: "unknown.dat", color: "LDraw 4", quantity: 3, reason: "Teilenummer fehlt oder ist mehrdeutig" },
  ]));
  const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  open();
  await act(async () => host.querySelector<HTMLButtonElement>('[data-testid="button-export-bricklink"]')!.click());
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("Keine Datei erstellt");
  expect(host.querySelector('[data-testid="bricklink-export-issues"]')?.textContent).toContain("3× unknown.dat");
  expect(host.textContent).toContain("LDraw 4");
  expect(click).not.toHaveBeenCalled();
});
