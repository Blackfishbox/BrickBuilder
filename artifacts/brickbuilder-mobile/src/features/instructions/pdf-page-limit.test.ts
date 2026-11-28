import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { expect, it, vi } from "vitest";
import { unzlibSync } from "fflate";
import { jsPDF } from "jspdf";
import { createEmptyDocument } from "../editor/model";
import { parseLDraw } from "../formats/ldraw/parser";
import { readStudioInstructions } from "./studio";
import { sourceInstructionPlan } from "./model";
import { exportInstructionPDF } from "./pdf";
import { exportStudioLayoutPDF } from "./studio-pdf";
import type { InstructionImageRenderer } from "./render";
import { PdfPageBudget } from "./pdf-page-budget";
import { translate } from "../../i18n/messages";

const image = `data:image/png;base64,${readFileSync(new URL("../../../public/icons/brickbuilder-192.png", import.meta.url)).toString("base64")}`;
const exports = { normal: exportInstructionPDF, studio: exportStudioLayoutPDF };

function fixture(count: number, pages?: string) {
  const document = createEmptyDocument("PDF example");
  const sourceText = Array.from({ length: count }, (_, index) =>
    `1 4 ${index * 40} 0 0 1 0 0 0 1 0 0 0 1 3001.dat\n0 STEP`).join("\n");
  document.imported = { version: 1, format: "io", sourceName: "example.io", sourceText,
    ...parseLDraw(sourceText), resources: {}, legalDocuments: [] };
  const xml = `<Instruction><GlobalSetting><PageSetup><PaperType>A4</PaperType><LengthUnit>Millimeters</LengthUnit>
    <Margins>10 10 10 10</Margins></PageSetup><GlobalStyle>
    <PartsList IsVisible="False"/><SubModelPreview IsVisible="False"/></GlobalStyle></GlobalSetting><Pages>
    ${pages ?? Array.from({ length: count }, (_, index) =>
      `<Page><Slot><Step SerializedIndex="${index}"/></Slot></Page>`).join("")}
    </Pages></Instruction>`;
  document.instructions = readStudioInstructions(xml, sourceInstructionPlan(document.imported));
  const renderer = { image: vi.fn<InstructionImageRenderer["image"]>(() => image), dispose: vi.fn() };
  const renderPart = vi.fn(async () => image);
  return { document, renderer, renderPart };
}

function pageCommands(bytes: Uint8Array): string[] {
  const raw = Buffer.from(bytes).toString("latin1");
  expect(raw).toMatch(/^%PDF-/);
  expect(raw.trimEnd()).toMatch(/%%EOF$/);
  const objects = new Map([...raw.matchAll(/(\d+)\s+0\s+obj([\s\S]*?)endobj/g)]
    .map(match => [Number(match[1]), match[2]]));
  return [...objects.values()].filter(body => /\/Type\s*\/Page\b/.test(body)).map(page => {
    const reference = page.match(/\/Contents\s+(\d+)\s+0\s+R/)![1];
    const body = objects.get(Number(reference))!;
    const stream = body.match(/stream\r?\n([\s\S]*?)\r?\nendstream/)![1];
    return Buffer.from(unzlibSync(Buffer.from(stream, "latin1"))).toString("latin1");
  });
}

for (const mode of ["normal", "studio"] as const) {
  it.each([9, 10, 12])(`${mode}: exports at most ten content pages and only adds a notice when truncated (%s)`, async count => {
    const { document, renderer, renderPart } = fixture(count);
    const onProgress = vi.fn();
    const bytes = await exports[mode](document, document.instructions!, { maxContentPages: 10, locale: "en", onProgress },
      async () => renderer, renderPart);
    const pages = pageCommands(bytes);
    expect(pages).toHaveLength(count > 10 ? 11 : count);
    expect(pages.join("\n").includes("(BrickBuilder Premium)")).toBe(count > 10);
    expect(renderer.image).toHaveBeenCalledTimes(Math.min(count, 10));
    expect(renderer.dispose).toHaveBeenCalledTimes(1);
    expect(onProgress).toHaveBeenLastCalledWith(Math.min(count, 10), Math.min(count, 10));
    for (const [done, total] of onProgress.mock.calls) expect(done).toBeLessThanOrEqual(total);
    if (count > 10) {
      expect(pages.at(-1)).toContain("/I");
      expect(pages.at(-1)).toContain("Further pages require");
      const directory = new URL("../../../../../generated-artifacts/pdf-page-limit/", import.meta.url);
      mkdirSync(directory, { recursive: true });
      writeFileSync(new URL(`${mode}-limited.pdf`, directory), bytes);
    }
  });

  it(`${mode}: leaves unrestricted exports unchanged`, async () => {
    const { document, renderer, renderPart } = fixture(12);
    const bytes = await exports[mode](document, document.instructions!, {}, async () => renderer, renderPart);
    expect(pageCommands(bytes)).toHaveLength(12);
    expect(renderer.image).toHaveBeenCalledTimes(12);
  });

  it(`${mode}: preserves cancellation and disposes the renderer at the boundary`, async () => {
    const { document, renderer, renderPart } = fixture(12);
    const controller = new AbortController();
    const onProgress = (done: number) => { if (done === 10) controller.abort(); };
    await expect(exports[mode](document, document.instructions!, {
      maxContentPages: 10, signal: controller.signal, onProgress,
    }, async () => renderer, renderPart)).rejects.toMatchObject({ name: "AbortError" });
    expect(renderer.image).toHaveBeenCalledTimes(10);
    expect(renderer.dispose).toHaveBeenCalledTimes(1);
  });

  it.each([9, 10])(`${mode}: counts axle appendices within the same ten-page budget after %s pages`, async count => {
    const { document, renderer, renderPart } = fixture(count);
    document.imported!.instances[0].part.name = "Technic Axle 4 with Stop";
    const bytes = await exports[mode](document, document.instructions!, { maxContentPages: 10, locale: "en" },
      async () => renderer, renderPart);
    const pages = pageCommands(bytes);
    expect(pages).toHaveLength(count + 1);
    expect(pages.at(-1)!.includes("(BrickBuilder Premium)")).toBe(count === 10);
    expect(pages.join("\n").includes("Axle measuring references")).toBe(count === 9);
  });

  it(`${mode}: propagates real rendering failures instead of disguising them as truncation`, async () => {
    const { document, renderer, renderPart } = fixture(12);
    renderer.image.mockImplementationOnce(() => { throw new Error("render failed"); });
    await expect(exports[mode](document, document.instructions!, { maxContentPages: 10 },
      async () => renderer, renderPart)).rejects.toThrow("render failed");
    expect(renderer.dispose).toHaveBeenCalledTimes(1);
  });
}

it("normal: counts notes continuation pages instead of steps and never renders the next step", async () => {
  const { document, renderer, renderPart } = fixture(10);
  document.instructions!.edited = true;
  document.instructions!.steps[0].notes = Array(40).fill("A note on its own line.").join("\n");
  const bytes = await exportInstructionPDF(document, document.instructions!, { maxContentPages: 10 },
    async () => renderer, renderPart);
  expect(pageCommands(bytes)).toHaveLength(11);
  expect(renderer.image.mock.calls.length).toBeLessThan(10);
});

it("normal: stops part-list overflow before rendering excluded thumbnails", async () => {
  const { document, renderer, renderPart } = fixture(1);
  document.bricks = Array.from({ length: 400 }, (_, index) => ({
    id: `brick-${index}`, type: "brick-2x4", x: 0, y: 0, z: 0, rotation: 0,
    color: `#${(0x204060 + index * 10007).toString(16).padStart(6, "0")}`,
  }));
  document.instructions!.edited = true;
  document.instructions!.steps[0].partIds.push(...document.bricks.map(brick => brick.id));
  const bytes = await exportInstructionPDF(document, document.instructions!, { maxContentPages: 10 },
    async () => renderer, renderPart);
  expect(pageCommands(bytes)).toHaveLength(11);
  expect(renderer.image).toHaveBeenCalledTimes(1);
  expect(renderPart).toHaveBeenCalledTimes(12 + 9 * 36);
});

it("normal: stops callout overflow before rendering excluded assemblies", async () => {
  const { document, renderer, renderPart } = fixture(1);
  document.instructions!.edited = true;
  document.instructions!.steps[0].notes = Array(40).fill("A note on its own line.").join("\n");
  document.instructions!.steps[0].callouts = Array.from({ length: 100 }, (_, index) => ({
    id: `callout-${index}`, title: "Assembly", occurrence: [0],
  }));
  const renderCallout = vi.fn(async () => image);
  const bytes = await exportInstructionPDF(document, document.instructions!, { maxContentPages: 10 },
    async () => renderer, renderPart, renderCallout);
  expect(pageCommands(bytes)).toHaveLength(11);
  expect(renderCallout.mock.calls.length).toBeLessThan(100);
  expect(renderer.dispose).toHaveBeenCalledOnce();
});

it("Studio: shares the total budget with multi-page inventories and skips excluded thumbnails", async () => {
  const { document, renderer, renderPart } = fixture(9);
  document.bricks = Array.from({ length: 35 }, (_, index) => ({
    id: `brick-${index}`, type: "brick-2x4", x: 0, y: 0, z: 0, rotation: 0,
    color: `#${(0x204060 + index * 10007).toString(16).padStart(6, "0")}`,
  }));
  document.instructions!.edited = true;
  document.instructions!.studioLayout!.sourceXml = document.instructions!.studioLayout!.sourceXml.replace(
    "</Pages>", `<Page><Slot><BOM id="inventory" useCostomizeContentRect="True" rect="0 0 60 55">
    <PartSize Scale="1"/><Label FontSize="9"/><Padding LRBT="2 2 2 2"/>
    </BOM></Slot></Page></Pages>`);
  const limited = await exportStudioLayoutPDF(document, document.instructions!, { maxContentPages: 10 },
    async () => renderer, renderPart);
  expect(pageCommands(limited)).toHaveLength(11);
  expect(renderer.image).toHaveBeenCalledTimes(9);
  const limitedThumbnails = renderPart.mock.calls.length;
  expect(limitedThumbnails).toBeGreaterThan(0);
  renderPart.mockClear();
  const unlimited = await exportStudioLayoutPDF(document, document.instructions!, {},
    async () => renderer, renderPart);
  expect(pageCommands(unlimited).length).toBeGreaterThan(11);
  expect(limitedThumbnails).toBeLessThan(renderPart.mock.calls.length);
  expect(renderPart).toHaveBeenCalledTimes(36);
});

it("Studio: counts source pages, not steps, and leaves individual late-page previews unrestricted", async () => {
  const { document, renderer, renderPart } = fixture(12,
    `<Page>${Array.from({ length: 12 }, (_, i) => `<Slot><Step SerializedIndex="${i}"/></Slot>`).join("")}</Page>`);
  const bytes = await exportStudioLayoutPDF(document, document.instructions!, { maxContentPages: 10 },
    async () => renderer, renderPart);
  expect(pageCommands(bytes)).toHaveLength(1);
  const late = fixture(12);
  const preview = await exportStudioLayoutPDF(late.document, late.document.instructions!, {
    maxContentPages: 10, previewPageIndex: 11,
  }, async () => late.renderer, late.renderPart);
  expect(pageCommands(preview)).toHaveLength(1);
  expect(pageCommands(preview)[0]).not.toContain("(BrickBuilder Premium)");
});

it("Studio: never loads images belonging only to excluded imported pages", async () => {
  const { document, renderer, renderPart } = fixture(10);
  document.instructions!.studioLayout!.sourceXml = document.instructions!.studioLayout!.sourceXml.replace(
    "</Pages>", '<Page><Image imagePath="not-present.png" rect="0 0 20 20"/></Page></Pages>');
  const bytes = await exportStudioLayoutPDF(document, document.instructions!, { maxContentPages: 10 },
    async () => renderer, renderPart);
  expect(pageCommands(bytes)).toHaveLength(11);
});

it.each(["de", "en"] as const)("uses a localized logo notice with a valid final page in %s", locale => {
  const pdf = new jsPDF();
  const budget = new PdfPageBudget(1);
  expect(() => budget.beforeNextPage(pdf)).toThrow();
  const addImage = vi.spyOn(pdf, "addImage");
  const text = vi.spyOn(pdf, "text");
  budget.appendNotice(pdf, locale);
  expect(pdf.getNumberOfPages()).toBe(2);
  expect(addImage).toHaveBeenCalledWith(expect.stringMatching(/^data:image\/png;base64,/),
    "PNG", 85, 48, 40, 40, undefined, "FAST");
  expect(text).toHaveBeenCalledWith(pdf.splitTextToSize(translate(locale, "premium.pdfLimitNotice"), 166),
    22, 128, expect.objectContaining({ lineHeightFactor: 1.5 }));
});
