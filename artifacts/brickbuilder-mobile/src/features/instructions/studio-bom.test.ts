import { expect, it, vi } from "vitest";
import { jsPDF } from "jspdf";
import { mkdirSync, writeFileSync } from "node:fs";
import { unzlibSync } from "fflate";
import { Resvg } from "@resvg/resvg-js";
import { createEmptyDocument } from "../editor/model";
import { parseLDraw } from "../formats/ldraw/parser";
import { studioNodes } from "./studio-layout";
import { drawStudioBom, planStudioBom, studioBomParts } from "./studio-bom";
import { exportStudioLayoutPDF } from "./studio-pdf";
import { sourceInstructionPlan } from "./model";
import { readStudioInstructions } from "./studio";
import { instructionPartImage } from "./part-images";
import { partProjectedSize } from "./part-projection";

const bomXml = `<BOM id="inventory" index="0" OrderBy="Color_Size_Ascending" IsShownAsRow="False">
  <PartSize Scale="1"/><Label FontSize="9" FontStyle="Bold"/><Padding LRBT="2 2 2 2"/>
  <Colors IsUseBgColor="False"/></BOM>`;
function fixture(count = 35, markup = bomXml) {
  const doc = createEmptyDocument("Parts inventory");
  doc.bricks = Array.from({ length: count }, (_, index) => ({
    id: `brick-${index}`, type: "brick-2x4" as const, x: 0, y: 0, z: 0, rotation: 0,
    color: `#${(0x204060 + index * 10007).toString(16).padStart(6, "0")}`,
  }));
  const nodes = studioNodes(`<Instruction><Pages><Page><Slot>${markup}</Slot></Page></Pages></Instruction>`);
  return { doc, nodes, bom: nodes.find(node => node.name === "BOM")! };
}
const testImage = `data:image/png;base64,${Buffer.from(new Resvg(
  '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8" fill="blue"/></svg>',
).render().asPng()).toString("base64")}`;
const png = () => testImage;
function pdfText(bytes: Uint8Array): string {
  return [...Buffer.from(bytes).toString("latin1").matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)].map(match => {
    try { return new TextDecoder().decode(unzlibSync(Buffer.from(match[1], "latin1"))); } catch { return ""; }
  }).join("\n");
}

it.each(["True", "False"])("flows all groups across pages without overlap or truncation in row mode %s", row => {
  const { doc, nodes, bom } = fixture(35, bomXml.replace('IsShownAsRow="False"', `IsShownAsRow="${row}"`));
  doc.bricks.push({ ...doc.bricks[0], id: "duplicate" });
  const pdf = new jsPDF();
  const pages = planStudioBom(pdf, doc, bom, nodes, [10, 20, 100, 70], 1, "en");
  expect(pages.length).toBeGreaterThan(1);
  const cells = pages.flatMap(page => page.cells);
  expect(cells).toHaveLength(35);
  expect(cells.reduce((sum, cell) => sum + cell.part.count, 0)).toBe(36);
  expect(new Set(cells.map(cell => cell.part.key)).size).toBe(35);
  for (const page of pages) {
    for (const cell of page.cells) {
      expect(cell.x).toBeGreaterThanOrEqual(12);
      expect(cell.y).toBeGreaterThanOrEqual(22);
      expect(cell.x + cell.width).toBeLessThanOrEqual(108.0001);
      expect(cell.y + cell.height).toBeLessThanOrEqual(88.0001);
      expect(cell.lines[1]).toBe("3001");
      expect(cell.lines.join(" ")).not.toContain("LDraw");
    }
    for (let i = 0; i < page.cells.length; i++) for (let j = i + 1; j < page.cells.length; j++) {
      const a = page.cells[i], b = page.cells[j];
      expect(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y).toBe(true);
    }
  }
});

it("combines matching occurrences even when one lacks geometry and separates colors", () => {
  const { doc } = fixture(0);
  const source = "1 4 0 0 0 1 0 0 0 1 0 0 0 1 3001.dat";
  doc.imported = { version: 1, format: "io", sourceName: "test.io", sourceText: source,
    ...parseLDraw(source), resources: {}, legalDocuments: [] };
  const part = doc.imported.instances[0];
  doc.imported.instances.push({ ...structuredClone(part), id: "resolved", part: { ...part.part, status: "resolved" } },
    { ...structuredClone(part), id: "other-color", colorCode: "1" });
  const groups = studioBomParts(doc);
  expect(groups).toHaveLength(2);
  expect(groups[0].count).toBe(2);
  expect(groups[0].kind === "imported" && groups[0].part.part.status).toBe("resolved");
});

it.each(["True", "False"])("uses one physical scale for tiny and oversized parts on every page (rows %s)", row => {
  const markup = bomXml.replace('IsShownAsRow="False"', `IsShownAsRow="${row}"`)
    .replace('<PartSize Scale="1"/>', '<PartSize Scale="1" EnableLargeBrickScale="True" LargeBrickScale="0.5"/>');
  const { doc, nodes, bom } = fixture(0, markup);
  const source = [1, 4, 400].map((size, index) =>
    `1 4 ${index * 500} 0 0 1 0 0 0 1 0 0 0 1 size${size}.dat`).join("\n");
  doc.imported = { version: 1, format: "io", sourceName: "scales.io", sourceText: source,
    ...parseLDraw(source), resources: {}, legalDocuments: [] };
  for (const [index, size] of [1, 4, 400].entries()) {
    const part = doc.imported.instances[index];
    part.part.status = "resolved";
    doc.imported.resources[`parts/${part.reference}`] = {
      path: `parts/${part.reference}`, source: "test", content: `3 16 0 0 0 ${size} 0 0 0 ${size} ${size}`,
      license: "CC0", authors: [], legalTextRefs: [],
    };
  }
  const pages = planStudioBom(new jsPDF(), doc, bom, nodes, [0, 0, 50, 50], 1, "en");
  expect(pages.length).toBeGreaterThan(1);
  const cells = pages.flatMap(page => page.cells);
  expect(cells).toHaveLength(3);
  const factors = cells.map(cell => {
    const projected = partProjectedSize(doc, cell.part)!;
    expect(cell.imageWidth / projected[0]).toBeCloseTo(cell.imageHeight / projected[1], 8);
    return cell.imageWidth / projected[0];
  });
  expect(factors[0]).toBeLessThan(1);
  expect(factors[1]).toBeCloseTo(factors[0], 8);
  expect(factors[2]).toBeCloseTo(factors[0], 8);
  // No nine-millimetre minimum that enlarges the smallest part.
  expect(cells[1].imageWidth / cells[0].imageWidth).toBeCloseTo(4, 6);
  expect(cells[2].imageWidth / cells[0].imageWidth).toBeCloseTo(400, 6);
});

it("measures local inventory parts in their canonical pose instead of assigning the same thumbnail size", () => {
  const { doc, nodes, bom } = fixture(2);
  doc.bricks[0].type = "brick-1x2";
  doc.bricks[0].tiltX = 72;
  doc.bricks[1].type = "brick-2x4";
  const cells = planStudioBom(new jsPDF(), doc, bom, nodes, [0, 0, 100, 100], 1, "en")[0].cells;
  expect(cells[1].imageWidth).toBeGreaterThan(cells[0].imageWidth);
  for (const cell of cells) {
    const [width, height] = partProjectedSize(doc, cell.part)!;
    expect(cell.imageWidth).toBeCloseTo(width);
    expect(cell.imageHeight).toBeCloseTo(height);
  }
});

it("keeps color names readable and validates tiny custom list rectangles", () => {
  const { doc, nodes, bom } = fixture(0);
  const source = "1 72 0 0 0 1 0 0 0 1 0 0 0 1 3001.dat";
  doc.imported = { version: 1, format: "io", sourceName: "test.io", sourceText: source,
    ...parseLDraw(source), resources: {}, legalDocuments: [] };
  const pages = planStudioBom(new jsPDF(), doc, bom, nodes, [0, 0, 100, 100], 1, "en");
  expect(pages[0].cells[0].lines.join(" ")).not.toContain("_");
  expect(() => planStudioBom(new jsPDF(), doc, bom, nodes, [0, 0, 8, 8], 1, "en")).toThrow(/too small/);
  expect(() => planStudioBom(new jsPDF(), doc, bom, nodes, [0, 0, 8, 8], 1, "de")).toThrow(/zu klein/);
});

it("prints localized preview failures without losing labels and stops on cancellation", async () => {
  const { doc, nodes, bom } = fixture(1);
  const pdf = new jsPDF({ compress: true });
  const page = planStudioBom(pdf, doc, bom, nodes, [0, 0, 100, 100], 1, "en")[0];
  await drawStudioBom(pdf, doc, page, "en", undefined, async () => { throw new Error("missing geometry"); });
  expect(pdfText(new Uint8Array(pdf.output("arraybuffer")))).toContain("Preview unavailable");
  const controller = new AbortController();
  controller.abort();
  const render = vi.fn(async () => png());
  await expect(drawStudioBom(pdf, doc, page, "en", controller.signal, render)).rejects.toThrow();
  expect(render).not.toHaveBeenCalled();
});

it("expands the source BOM into complete PDF pages, previews only the BOM, and deduplicates saved continuation markers", async () => {
  const { doc } = fixture(35);
  const source = "1 4 0 0 0 1 0 0 0 1 0 0 0 1 3001.dat\n0 STEP";
  doc.imported = { version: 1, format: "io", sourceName: "test.io", sourceText: source,
    ...parseLDraw(source), resources: {}, legalDocuments: [] };
  const xml = `<Instruction><GlobalSetting><PageSetup><PaperType>Custom</PaperType>
    <LengthUnit>Millimeters</LengthUnit><CustomSize>100 120</CustomSize><IsPortrait>False</IsPortrait><Margins>5 5 5 5</Margins></PageSetup>
    <GlobalStyle><PartsList IsVisible="False"/></GlobalStyle></GlobalSetting><Pages>
    <Page template="OneByOne"><Slot><Step SerializedIndex="0"/></Slot></Page>
    <Page template="OneByOne"><Slot>${bomXml}</Slot></Page>
    <Page template="OneByOne"><Slot>${bomXml.replace('index="0"', 'index="1"')}</Slot></Page>
    <Page template="OneByOne"><Slot/></Page>
    <Page template="OneByOne"><Slot/></Page>
    </Pages></Instruction>`;
  doc.instructions = readStudioInstructions(xml, sourceInstructionPlan(doc.imported));
  const expectedInventoryPages = planStudioBom(new jsPDF(), doc, fixture(0).bom, fixture(0).nodes,
    [5, 5, 110, 90], 1, "en").length;
  const renderer = { image: vi.fn(() => png()), dispose: vi.fn() };
  const partImages = vi.fn(async () => png());
  const progress: [number, number][] = [];
  const bytes = await exportStudioLayoutPDF(doc, doc.instructions, {
    locale: "en", onProgress: (done, total) => progress.push([done, total]),
  }, async () => renderer, partImages);
  const count = Number(/\/Count\s+(\d+)\b/.exec(Buffer.from(bytes).toString("latin1"))![1]);
  expect(count).toBe(expectedInventoryPages + 1);
  expect(partImages).toHaveBeenCalledTimes(36);
  expect(renderer.image).toHaveBeenCalledOnce();
  expect(progress.at(-1)).toEqual([count, count]);
  expect(doc.instructions.studioLayout!.sourceXml).toBe(xml);
  partImages.mockClear();
  renderer.image.mockClear();
  const preview = await exportStudioLayoutPDF(doc, doc.instructions, {
    locale: "en", previewPageIndex: 1,
  }, async () => renderer, partImages);
  expect(Number(/\/Count\s+(\d+)\b/.exec(Buffer.from(preview).toString("latin1"))![1])).toBe(expectedInventoryPages);
  expect(renderer.image).not.toHaveBeenCalled();
  expect(partImages).toHaveBeenCalledTimes(36);
});

it("renders a real multi-page parts PDF with geometry-backed thumbnails for visual inspection", async () => {
  const { doc, nodes, bom } = fixture(14);
  const pdf = new jsPDF({ unit: "mm", format: [100, 100], compress: true });
  const pages = planStudioBom(pdf, doc, bom, nodes, [5, 5, 90, 90], 1, "en");
  expect(pages.length).toBeGreaterThan(1);
  vi.stubGlobal("document", { createElement: () => {
    let paths: string[] = [], path = "";
    const stack: object[] = [];
    const context = {
      fillStyle: "", strokeStyle: "", globalAlpha: 1, lineWidth: 1,
      save() { stack.push({ strokeStyle: this.strokeStyle, fillStyle: this.fillStyle,
        globalAlpha: this.globalAlpha, lineWidth: this.lineWidth }); },
      restore() { Object.assign(this, stack.pop()); },
      beginPath() { path = ""; }, closePath() { path += "Z"; },
      moveTo(x: number, y: number) { path += `M${x} ${y}`; },
      lineTo(x: number, y: number) { path += `L${x} ${y}`; },
      fill() { paths.push(`<path d="${path}" fill="${this.fillStyle}" opacity="${this.globalAlpha}"/>`); },
      stroke() { paths.push(`<path d="${path}" fill="none" stroke="${this.strokeStyle}" stroke-width="${this.lineWidth}"/>`); },
      fillRect(x: number, y: number, width: number, height: number) {
        paths = [`<rect x="${x}" y="${y}" width="${width}" height="${height}" fill="${this.fillStyle}"/>`];
      },
    };
    return { width: 0, height: 0, getContext: () => context, toDataURL() {
      return `data:image/png;base64,${Buffer.from(new Resvg(
        `<svg xmlns="http://www.w3.org/2000/svg" width="${this.width}" height="${this.height}">${paths.join("")}</svg>`,
      ).render().asPng()).toString("base64")}`;
    } };
  } });
  try {
    for (const [index, page] of pages.entries()) {
      if (index) pdf.addPage([100, 100]);
      await drawStudioBom(pdf, doc, page, "en", undefined, instructionPartImage);
    }
    const bytes = new Uint8Array(pdf.output("arraybuffer"));
    expect(Buffer.from(bytes).toString("latin1").match(/\/Subtype \/Image/g)?.length).toBeGreaterThanOrEqual(14);
    const directory = new URL("../../../generated-artifacts/", import.meta.url);
    mkdirSync(directory, { recursive: true });
    writeFileSync(new URL("studio-bom-pages.pdf", directory), bytes);
  } finally { vi.unstubAllGlobals(); }
}, 20_000);
