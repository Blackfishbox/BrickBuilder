// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import FormatDialog from "./FormatDialog";
import { createEmptyDocument } from "../editor/model";
import { ViewExportError, type ViewExportOptions } from "../engine/view-export";

const save = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock("@/platform/export-file", () => ({ exportFile: save }));

afterEach(() => { save.mockClear(); vi.unstubAllGlobals(); });

describe("image export from the file export dialog", () => {
  it("shows native cache failures and permits another SVG export", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const host = document.createElement("div");
    const root = createRoot(host);
    save.mockRejectedValueOnce(new Error("Cache full"));
    await act(async () => root.render(<FormatDialog document={createEmptyDocument()}
      initialMode="export" viewExporterRef={{ current: async () => new Uint8Array([1]) }}
      onClose={() => {}} onImport={async () => {}} />));
    const click = async () => {
      await act(async () => {
        (host.querySelector('[data-testid="button-export-svg"]') as HTMLButtonElement).click();
        await new Promise(resolve => setTimeout(resolve, 80));
      });
    };
    try {
      await click();
      expect(host.querySelector('[data-testid="status-export-error"]')?.textContent?.trim()).toBeTruthy();
      expect((host.querySelector('[data-testid="button-export-svg"]') as HTMLButtonElement).disabled).toBe(false);
      await click();
      expect(save).toHaveBeenCalledTimes(2);
      expect(host.querySelector('[data-testid="status-export-error"]')).toBeNull();
    } finally { await act(async () => root.unmount()); }
  });

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
        expect(exporter).toHaveBeenLastCalledWith(format, {
          signal: expect.any(AbortSignal), onProgress: expect.any(Function),
        });
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
      expect(host.querySelector('[role="alert"]')?.textContent).toContain("900.000");
      expect(save).not.toHaveBeenCalled();
    } finally { await act(async () => root.unmount()); }
  });

  it("shows progress, cancels without sharing a partial file and permits a retry", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const host = document.createElement("div");
    const root = createRoot(host);
    let options: ViewExportOptions | undefined;
    const bytes = new Uint8Array([1, 2, 3]);
    const exporter = vi.fn((_format: string, value?: ViewExportOptions): Promise<Uint8Array> => {
      options = value;
      return new Promise((_, reject) => {
        value?.signal?.addEventListener("abort", () => reject(new ViewExportError("cancelled")), { once: true });
      });
    });
    await act(async () => root.render(<FormatDialog document={createEmptyDocument()}
      initialMode="export" viewExporterRef={{ current: exporter }}
      onClose={() => {}} onImport={async () => {}} />));
    try {
      await act(async () => {
        (host.querySelector('[data-testid="button-export-svg"]') as HTMLButtonElement).click();
        await new Promise(resolve => setTimeout(resolve, 80));
      });
      await act(async () => options?.onProgress?.({ phase: "sort", completed: 500, total: 1000 }));
      expect(host.querySelector('[data-testid="status-svg-progress"]')?.textContent).toContain("500");
      expect(host.querySelector("progress")?.value).toBe(500);
      expect((host.querySelector('[data-testid="tab-format-import"]') as HTMLButtonElement).disabled).toBe(true);
      await act(async () => (host.querySelector('[data-testid="button-cancel-view-export"]') as HTMLButtonElement).click());
      expect(options?.signal?.aborted).toBe(true);
      expect(save).not.toHaveBeenCalled();
      expect(host.textContent).toContain("Bildexport abgebrochen");
      expect(host.querySelector('[role="alert"]')).toBeNull();
      expect(host.querySelector('[data-testid="status-svg-progress"]')).toBeNull();
      exporter.mockImplementation(async () => bytes);
      await act(async () => {
        (host.querySelector('[data-testid="button-export-svg"]') as HTMLButtonElement).click();
        await new Promise(resolve => setTimeout(resolve, 80));
      });
      expect(save).toHaveBeenCalledOnce();
      expect(host.textContent).not.toContain("Bildexport abgebrochen");
    } finally { await act(async () => root.unmount()); }
  });

  it.each(["button", "escape", "backdrop", "unmount"])("aborts when closing via %s and never shares late results", async how => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const host = document.createElement("div");
    const root = createRoot(host);
    const close = vi.fn();
    let options: ViewExportOptions | undefined;
    let finish: (bytes: Uint8Array) => void = () => {};
    const exporter = (_format: string, value?: ViewExportOptions): Promise<Uint8Array> => {
      options = value;
      return new Promise(resolve => { finish = resolve; });
    };
    await act(async () => root.render(<FormatDialog document={createEmptyDocument()}
      initialMode="export" viewExporterRef={{ current: exporter }}
      onClose={close} onImport={async () => {}} />));
    try {
      await act(async () => {
        (host.querySelector('[data-testid="button-export-svg"]') as HTMLButtonElement).click();
        await new Promise(resolve => setTimeout(resolve, 80));
      });
      await act(async () => {
        if (how === "button") (host.querySelector('[data-testid="button-close-formats"]') as HTMLButtonElement).click();
        if (how === "escape") window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
        if (how === "backdrop") host.querySelector(".fmt-scrim")!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
        if (how === "unmount") root.unmount();
        finish(new Uint8Array([1, 2, 3]));
      });
      expect(options?.signal?.aborted).toBe(true);
      expect(save).not.toHaveBeenCalled();
      if (how !== "unmount") expect(close).toHaveBeenCalledOnce();
    } finally { if (how !== "unmount") await act(async () => root.unmount()); }
  });
});
