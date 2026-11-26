import { expect, it, vi } from "vitest";
import { createEmptyDocument } from "../editor/model";
import { exportInstructionCalloutImage } from "./callouts";
import { createExportInstructionRenderer } from "./export-renderer";
import { renderInstructionImage, type InstructionImageRenderer } from "./render";
import { IDENTITY } from "../formats/ldraw/parser";
import { parseLDraw } from "../formats/ldraw/parser";

vi.mock("../../platform/pdf-background", () => ({ yieldPdfExecution: vi.fn(async () => {}) }));

const lost = () => Object.assign(new Error("PDF_WEBGL_CONTEXT_LOST"), { code: "PDF_WEBGL_CONTEXT_LOST" });
const visible = new Set(["part"]);
const step = { id: "step", title: "", notes: "", partIds: ["part"] };
function imageRenderer(): InstructionImageRenderer {
  return { image: vi.fn(() => "data:image/png;base64,full-detail"), dispose: vi.fn() };
}

it("retries only the interrupted image in a replacement WebGL context", async () => {
  const first = imageRenderer(), next = imageRenderer();
  const factory = vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(next);
  const document = createEmptyDocument();
  const renderer = await createExportInstructionRenderer(document, undefined, factory);
  await expect(renderInstructionImage(renderer, visible, step)).resolves.toContain("full-detail");
  vi.mocked(first.image).mockImplementationOnce(() => { throw lost(); });
  await expect(renderInstructionImage(renderer, visible, step, visible, 4 / 3)).resolves.toContain("full-detail");
  expect(first.dispose).toHaveBeenCalledOnce();
  expect(factory).toHaveBeenLastCalledWith(document, undefined, { requireWebGL: true });
  expect(next.image).toHaveBeenCalledWith(visible, step, visible, 4 / 3);
  renderer.dispose(); renderer.dispose();
  expect(next.dispose).toHaveBeenCalledOnce();
});

it("bounds recovery attempts across the export and preserves a final context-loss error", async () => {
  const renderers = Array.from({ length: 3 }, () => {
    const renderer = imageRenderer();
    vi.mocked(renderer.image).mockImplementation(() => { throw lost(); });
    return renderer;
  });
  const factory = vi.fn().mockImplementation(async () => renderers[factory.mock.calls.length - 1]);
  const renderer = await createExportInstructionRenderer(createEmptyDocument(), undefined, factory);
  await expect(renderInstructionImage(renderer, visible, step)).rejects.toMatchObject({ code: "PDF_WEBGL_CONTEXT_LOST" });
  expect(factory).toHaveBeenCalledTimes(3);
  renderer.dispose();
  renderers.forEach(item => expect(item.dispose).toHaveBeenCalledOnce());
});

it("does not restart or hide unrelated geometry errors", async () => {
  const current = imageRenderer();
  vi.mocked(current.image).mockImplementation(() => { throw new Error("missing geometry"); });
  const factory = vi.fn().mockResolvedValue(current);
  const renderer = await createExportInstructionRenderer(createEmptyDocument(), undefined, factory);
  await expect(renderInstructionImage(renderer, visible, step)).rejects.toThrow("missing geometry");
  expect(factory).toHaveBeenCalledOnce();
  renderer.dispose();
});

it("honors cancellation before recreating the renderer", async () => {
  const controller = new AbortController(), current = imageRenderer();
  vi.mocked(current.image).mockImplementation(() => {
    controller.abort();
    throw lost();
  });
  const factory = vi.fn().mockResolvedValue(current);
  const renderer = await createExportInstructionRenderer(createEmptyDocument(), controller.signal, factory);
  await expect(renderInstructionImage(renderer, visible, step)).rejects.toMatchObject({ name: "AbortError" });
  expect(factory).toHaveBeenCalledOnce();
  renderer.dispose();
});

it("reuses one export renderer for scoped assembly previews, including nested occurrences", async () => {
  const document = createEmptyDocument();
  const parsed = parseLDraw("0 FILE root.ldr\n1 4 0 0 0 1 0 0 0 1 0 0 0 1 3001.dat");
  document.imported = {
    ...parsed, version: 1, format: "io", sourceName: "local.io", sourceText: "", originalBytes: [],
    resources: {}, legalDocuments: [],
  };
  const base = document.imported.instances[0];
  document.imported.instances = [
    { ...base, id: "assembly-a", sourceOccurrence: [1, 0], matrix: [...IDENTITY] },
    { ...base, id: "assembly-b", sourceOccurrence: [1, 1, 0], matrix: [...IDENTITY] },
    { ...base, id: "unrelated", sourceOccurrence: [2, 0], matrix: [...IDENTITY] },
  ];
  const renderer = imageRenderer();
  renderer.imageAsync = vi.fn(async () => "data:image/png;base64,assembly");
  const image = await exportInstructionCalloutImage(document,
    { id: "assembly", title: "Assembly", occurrence: [1] }, renderer);
  expect(image).toContain("assembly");
  expect(renderer.imageAsync).toHaveBeenCalledWith(new Set(["assembly-a", "assembly-b"]),
    { id: "assembly", title: "Assembly", notes: "", partIds: ["assembly-a", "assembly-b"] }, undefined, 4 / 3);
  expect(renderer.image).not.toHaveBeenCalled();
  expect(renderer.dispose).not.toHaveBeenCalled();
});
