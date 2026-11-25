import { beforeEach, expect, it, vi } from "vitest";
import { createEmptyDocument } from "../features/editor/model";
const mocks = vi.hoisted(() => ({
  normal: vi.fn(async () => new Uint8Array([1, 2])),
  studio: vi.fn(async () => new Uint8Array([3, 4])),
  prepare: vi.fn(async () => ({ share: vi.fn(async () => {}) })),
  share: vi.fn(async () => {}),
  protect: vi.fn(),
}));
vi.mock("../features/instructions/pdf", () => ({ exportInstructionPDF: mocks.normal }));
vi.mock("../features/instructions/studio-pdf", () => ({ exportStudioLayoutPDF: mocks.studio }));
vi.mock("./export-file", () => ({ prepareExportFile: mocks.prepare, sharePreparedExport: mocks.share }));
vi.mock("./pdf-background", () => ({ withPdfBackgroundExport: mocks.protect }));
import { exportInstructionPdfFile } from "./instruction-pdf-export";
beforeEach(() => vi.clearAllMocks());

it.each([false, true])("protects rendering and local saving before sharing for Studio=%s", async studio => {
  const signal = new AbortController().signal, progress = vi.fn(), retained = vi.fn();
  let saved!: unknown;
  mocks.protect.mockImplementationOnce(async (_locale, currentSignal, onProgress, operation) => {
    expect(currentSignal).toBe(signal);
    const result = await operation(currentSignal, onProgress);
    saved = result;
    expect(retained).toHaveBeenCalledWith(result);
    expect(mocks.share).not.toHaveBeenCalled();
    return result;
  });
  await exportInstructionPdfFile({
    document: createEmptyDocument("Truck"), plan: { version: 1, steps: [] },
    locale: "en", signal, highlight: true, studio, onProgress: progress, onPrepared: retained,
  });
  expect(studio ? mocks.studio : mocks.normal).toHaveBeenCalledWith(expect.anything(), expect.anything(),
    { signal, onProgress: progress, highlight: true, locale: "en" });
  expect(mocks.prepare).toHaveBeenCalledWith(new Uint8Array(studio ? [3, 4] : [1, 2]),
    studio ? "Truck-Studio-Layout.pdf" : "Truck-Instructions.pdf", "application/pdf", signal);
  expect(mocks.share).toHaveBeenCalledWith(saved);
});

it("does not save or share stale images after a lost graphics context", async () => {
  mocks.protect.mockImplementationOnce(async (_locale, signal, progress, operation) => operation(signal, progress));
  mocks.normal.mockRejectedValueOnce(Object.assign(new Error("PDF_WEBGL_CONTEXT_LOST"), { code: "PDF_WEBGL_CONTEXT_LOST" }));
  await expect(exportInstructionPdfFile({
    document: createEmptyDocument("Model"), plan: { version: 1, steps: [] }, locale: "de",
    signal: new AbortController().signal, onProgress: vi.fn(), highlight: false, onPrepared: vi.fn(),
  })).rejects.toThrow("Es wurde keine unvollständige PDF geteilt");
  expect(mocks.prepare).not.toHaveBeenCalled();
  expect(mocks.share).not.toHaveBeenCalled();
});
