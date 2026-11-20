// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import FormatDialog from "./FormatDialog";
import { createEmptyDocument } from "../editor/model";
import { ViewExportError } from "../engine/view-export";

const save = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock("@/platform/export-file", () => ({ exportFile: save }));

afterEach(() => { save.mockClear(); vi.unstubAllGlobals(); });

describe("image export from the file export dialog", () => {
  it("exports the current view and shares a named PNG or SVG", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const host = document.createElement("div");
    const root = createRoot(host);
    const bytes = new Uint8Array([1, 2, 3]);
    const exporter = vi.fn(async () => bytes);
    await act(async () => root.render(<FormatDialog document={createEmptyDocument("Test Model")}
      initialMode="export" viewExporterRef={{ current: exporter }}
      onClose={() => {}} onImport={async () => {}} />));
    try {
      for (const format of ["png", "svg"]) {
        await act(async () => {
          (host.querySelector(`[data-testid="button-export-${format}"]`) as HTMLButtonElement).click();
          await new Promise(resolve => setTimeout(resolve, 80));
        });
        expect(exporter).toHaveBeenLastCalledWith(format);
        expect(save).toHaveBeenLastCalledWith(bytes, `Test Model-4k.${format}`,
          format === "png" ? "image/png" : "image/svg+xml");
      }
    } finally { await act(async () => root.unmount()); }
  });

  it("shows a clear error rather than silently exporting missing geometry", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const host = document.createElement("div");
    const root = createRoot(host);
    await act(async () => root.render(<FormatDialog document={createEmptyDocument()}
      initialMode="export" viewExporterRef={{ current: async () => { throw new ViewExportError("complex"); } }}
      onClose={() => {}} onImport={async () => {}} />));
    try {
      await act(async () => {
        (host.querySelector('[data-testid="button-export-svg"]') as HTMLButtonElement).click();
        await new Promise(resolve => setTimeout(resolve, 80));
      });
      expect(host.querySelector('[role="alert"]')?.textContent).toContain("150.000");
      expect(save).not.toHaveBeenCalled();
    } finally { await act(async () => root.unmount()); }
  });
});
