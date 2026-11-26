import { mkdirSync, writeFileSync } from "node:fs";
import { jsPDF } from "jspdf";
import { unzlibSync } from "fflate";
import { describe, expect, it } from "vitest";
import { createEmptyDocument } from "../editor/model";
import { parseLDraw } from "../formats/ldraw/parser";
import { readStudioInstructions } from "./studio";
import { sourceInstructionPlan } from "./model";
import { studioNodes } from "./studio-layout";
import { drawStudioSizeGuide, studioSizeGuideLabels } from "./studio-size-guide";
import { sizeGuideProjection } from "./size-guide-geometry";
import { exportStudioLayoutPDF } from "./studio-pdf";
import { createSoftwareInstructionRenderer } from "./software-render";
import { Resvg } from "@resvg/resvg-js";

// Original synthetic geometry: freely publishable, no catalog/private meshes.
// Cross-section boxes include real thickness, asymmetrical stops and offsets.
function box(x: number, y: number, z: number, w: number, h: number, d: number) {
  const v = [[x,y,z], [x+w,y,z], [x+w,y+h,z], [x,y+h,z],
    [x,y,z+d], [x+w,y,z+d], [x+w,y+h,z+d], [x,y+h,z+d]];
  return [[0,1,2,3], [4,5,6,7], [0,1,5,4], [3,2,6,7], [0,3,7,4], [1,2,6,5]]
    .map(face => `4 16 ${face.flatMap(index => v[index]).join(" ")}`).join("\n");
}
function fixture() {
  const definitions = [
    ["half.dat", "Technic Axle 5.5", box(7, -8, 12, 110, 8, 8)],
    ["stop.dat", "Technic Axle 4 with Stop", `${box(0, 0, 0, 82, 8, 8)}\n${box(10, -3, -3, 4, 14, 14)}`],
    ["vertical.dat", "Technic Axle 3", box(-4, -30, -4, 8, 60, 8)],
    ["deep.dat", "Technic Axle 2.5", box(-4, -4, -20, 8, 8, 50)],
  ];
  const sourceText = definitions.map(([reference]) => `1 16 100 200 300 0 -1 0 1 0 0 0 0 1 ${reference}`).join("\n");
  const document = createEmptyDocument("Synthetic physical size guides");
  document.imported = { version: 1, format: "io", sourceName: "synthetic.ldr", sourceText,
    ...parseLDraw(sourceText), resources: {}, legalDocuments: [] };
  for (const [reference, name, content] of definitions) {
    const path = `parts/${reference}`;
    document.imported.resources[path] = { path, content, license: "CC0-1.0", author: "BrickBuilder synthetic fixture", sourceUrl: "" };
    const part = document.imported.instances.find(part => part.reference === reference)!;
    part.part = { ...part.part, name, status: "resolved" };
  }
  return document;
}
function node(parts = "half.dat\nstop.dat\nvertical.dat\ndeep.dat", rect = "0.1 0.9 70 15") {
  return studioNodes(`<Instruction><SizeGuide rect="${rect}" Parts="${parts.replaceAll("\n", "&#10;")}"/></Instruction>`)[1];
}
function streams(bytes: Uint8Array) {
  const raw = Buffer.from(bytes).toString("latin1");
  return [...raw.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)].map(match => {
    const content = Buffer.from(match[1], "latin1");
    try { return Buffer.from(unzlibSync(content)).toString("latin1"); } catch { return content.toString("latin1"); }
  }).join("\n");
}
/** Read serialized PDF path coordinates (points), not calls to a mocked writer. */
function triangles(commands: string) {
  const n = "(-?[\\d.]+)";
  const pattern = new RegExp(`${n} ${n} m\\s+${n} ${n} l\\s+${n} ${n} l\\s+(?:-?[\\d.]+ -?[\\d.]+ l\\s+)?h\\s+f`, "g");
  return [...commands.matchAll(pattern)].map(match => match.slice(1).map(Number));
}

describe("physical source-geometry size guides", () => {
  it("preserves half lengths, off-center stops and all three source axes without occurrence transforms", () => {
    const document = fixture();
    expect(studioSizeGuideLabels(document, "half.dat")[0]).toMatch(/^5.5L/);
    const half = sizeGuideProjection(document, "half.dat")!;
    expect(half.width).toBe(44);
    expect(half.height).toBe(3.2);
    const stop = sizeGuideProjection(document, "stop.dat")!;
    expect(stop.width).toBeCloseTo(32.8); // Nominal 4L must NOT stretch the mesh to 32 mm.
    expect(stop.height).toBeCloseTo(5.6);
    const xs = stop.triangles.flatMap(t => [t[0], t[2], t[4]]);
    expect(xs).toContain(4); // Stop is 10 LDU from the end, not stretched to it.
    expect(xs).toContain(5.6000000000000005);
    expect(sizeGuideProjection(document, "vertical.dat")!.width).toBe(24);
    expect(sizeGuideProjection(document, "deep.dat")!.width).toBe(20);
  });

  it.each(["mm", "pt"] as const)("writes exact physical PDF paths using %s coordinates", unit => {
    const pdf = new jsPDF({ unit, compress: false });
    const scale = 72 / 25.4 / pdf.internal.scaleFactor;
    drawStudioSizeGuide(pdf, fixture(), node(), [5 * scale, 5 * scale, 200 * scale, 280 * scale], "en");
    const bytes = new Uint8Array(pdf.output("arraybuffer"));
    const raw = Buffer.from(bytes).toString("latin1");
    expect(raw).toContain("/PrintScaling /None");
    expect(raw).toContain("100% / Actual size");
    expect(raw).not.toContain("/Subtype /Image");
    const paths = triangles(streams(bytes));
    expect(paths).toHaveLength(20); // Two projected faces (4 triangles) per box, including stop.
    const widths = paths.map(t => (Math.max(t[0], t[2], t[4]) - Math.min(t[0], t[2], t[4])) * 25.4 / 72);
    for (const width of [44, 32.8, 24, 20, 1.6]) expect(widths.some(value => Math.abs(value - width) < 0.00001)).toBe(true);
    const heights = paths.map(t => (Math.max(t[1], t[3], t[5]) - Math.min(t[1], t[3], t[5])) * 25.4 / 72);
    for (const height of [3.2, 5.6]) expect(heights.some(value => Math.abs(value - height) < 0.00001)).toBe(true);
  });

  it("retains measured lengths without catalog names and reads native row delimiters", () => {
    const document = fixture();
    delete document.imported!.instances[0].part.name;
    expect(studioSizeGuideLabels(document, "half.dat&#10;stop.dat&#x0A;deep.dat")).toEqual([
      "44 mm · half", "4L · Technic Axle 4 with Stop · stop", "2.5L · Technic Axle 2.5 · deep",
    ]);
  });

  it("never fits oversized geometry, invents missing meshes, or claims a failed image is 1:1", () => {
    const document = fixture();
    const pdf = new jsPDF({ compress: false });
    drawStudioSizeGuide(pdf, document, node("half.dat", "0 1 20 15"), [5, 5, 30, 100], "en");
    expect(pdf.output()).toContain("space");
    expect(pdf.output()).not.toContain("1:1");
    expect(triangles(pdf.output())).toHaveLength(0);
    delete document.imported!.resources["parts/stop.dat"];
    const missing = new jsPDF({ compress: false });
    drawStudioSizeGuide(missing, document, node("stop.dat"), [5, 5, 200, 280], "en");
    expect(missing.output()).toContain("geometry unavailable");
    expect(missing.output()).not.toContain("1:1");
    const broken = fixture();
    broken.imported!.resources["parts/half.dat"].content = "1 16 0 0 0 1 0 0 0 1 0 0 0 1 missing.dat";
    const invalid = new jsPDF({ compress: false });
    drawStudioSizeGuide(invalid, broken, node("half.dat"), [5, 5, 200, 280], "en");
    expect(invalid.output()).toContain("geometry unavailable");
    expect(triangles(invalid.output())).toHaveLength(0);
  });

  it("handles hidden guides, width expansion and a page too short without clipping a measuring image", () => {
    const hidden = node(); hidden.attributes.IsVisible = "False";
    const pdf = new jsPDF({ compress: false });
    drawStudioSizeGuide(pdf, fixture(), hidden, [5, 5, 200, 280]);
    expect(triangles(pdf.output())).toHaveLength(0);
    drawStudioSizeGuide(pdf, fixture(), node("half.dat", "1 0 10 15"), [5, 5, 200, 280]);
    expect(triangles(pdf.output()).length).toBeGreaterThan(0);
    expect(pdf.output()).toContain("100%");
    expect(pdf.output()).toContain("Seitenanpassung");
    expect(() => drawStudioSizeGuide(pdf, fixture(), node(), [5, 5, 200, 10])).toThrow("Platz");
  });

  it("exports a complete native Studio PDF with actual software-rendered models and measurable vectors", async () => {
    const document = fixture();
    const guide = '<SizeGuide rect="0.05 0.9 100 15" Parts="half.dat&#10;stop.dat&#10;vertical.dat&#10;deep.dat"/>';
    const xml = `<Instruction><GlobalSetting><PageSetup><PaperType>A4</PaperType>
      <LengthUnit>Millimeters</LengthUnit><Margins>5 5 5 5</Margins></PageSetup><GlobalStyle>
      <PartsList IsVisible="False"/><SubModelPreview IsVisible="False"/></GlobalStyle></GlobalSetting>
      <Pages><Page><Slot><Step SerializedIndex="0"/>${guide}</Slot></Page></Pages></Instruction>`;
    document.instructions = readStudioInstructions(xml, sourceInstructionPlan(document.imported!));
    const original = globalThis.document;
    globalThis.document = { createElement: () => {
      let paths: string[] = [], path = "";
      const context = {
        fillStyle: "", strokeStyle: "", globalAlpha: 1, lineWidth: 1,
        clearRect() { paths = []; },
        beginPath() { path = ""; },
        moveTo(x: number, y: number) { path += `M${x} ${y}`; },
        lineTo(x: number, y: number) { path += `L${x} ${y}`; },
        closePath() { path += "Z"; },
        fill() { paths.push(`<path d="${path}" fill="${this.fillStyle}" opacity="${this.globalAlpha}"/>`); },
        stroke() { paths.push(`<path d="${path}" fill="none" stroke="${this.strokeStyle}" stroke-width="${this.lineWidth}"/>`); },
        fillRect(x: number, y: number, w: number, h: number) {
          paths = [`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${this.fillStyle}"/>`];
        },
      };
      return {
        width: 1, height: 1, getContext: () => context,
        toDataURL() {
          const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${this.width}" height="${this.height}">${paths.join("")}</svg>`;
          return `data:image/png;base64,${new Resvg(svg).render().asPng().toString("base64")}`;
        },
      };
    } } as unknown as Document;
    try {
      const bytes = await exportStudioLayoutPDF(document, document.instructions, { locale: "en" },
        createSoftwareInstructionRenderer);
      const commands = streams(bytes);
      expect(commands.includes("5.5L")).toBe(true);
      expect(commands.includes("with Stop")).toBe(true);
      expect(commands.includes("1:1")).toBe(true);
      const paths = triangles(commands);
      expect(paths).toHaveLength(20);
      const widths = paths.map(t => (Math.max(t[0], t[2], t[4]) - Math.min(t[0], t[2], t[4])) * 25.4 / 72);
      for (const width of [44, 32.8, 24, 20, 1.6]) {
        expect(widths.some(value => Math.abs(value - width) < 0.00001)).toBe(true);
      }
      expect(Buffer.from(bytes).toString("latin1")).toContain("/Subtype /Image");
      const directory = new URL("../../../generated-artifacts/", import.meta.url);
      mkdirSync(directory, { recursive: true });
      writeFileSync(new URL("synthetic-size-guides.pdf", directory), bytes);
    } finally { globalThis.document = original; }
  });
});
