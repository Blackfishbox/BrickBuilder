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
import { instructionAxle } from "./axles";
import { appendAxleGuidePages, collectAxleGuides, nativeAxleGuideReferences, type AxleGuideCollection } from "./axle-guides";
import { instructionHighlightIds } from "./callouts";
import { exportInstructionPDF } from "./pdf";

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

  it.each(["native", "automatic", "normal"])("exports a complete %s PDF with actual software-rendered models and measurable vectors", async mode => {
    const document = fixture();
    const guide = '<SizeGuide rect="0.05 0.9 100 15" Parts="half.dat&#10;stop.dat&#10;vertical.dat&#10;deep.dat"/>';
    const xml = `<Instruction><GlobalSetting><PageSetup><PaperType>A4</PaperType>
      <LengthUnit>Millimeters</LengthUnit><Margins>5 5 5 5</Margins></PageSetup><GlobalStyle>
      <PartsList IsVisible="${mode === "native" ? "False" : "True"}"/><SubModelPreview IsVisible="False"/></GlobalStyle></GlobalSetting>
      <Pages><Page><Slot><Step SerializedIndex="0"/>${mode === "native" ? guide : ""}</Slot></Page></Pages></Instruction>`;
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
      const bytes = mode === "normal"
        ? await exportInstructionPDF(document, document.instructions, { locale: "de" }, createSoftwareInstructionRenderer)
        : await exportStudioLayoutPDF(document, document.instructions, { locale: "en" }, createSoftwareInstructionRenderer);
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
      if (mode !== "native") {
        expect(commands).toContain(mode === "normal" ? "Achsen-Messhilfen" : "Axle measuring references");
        expect(commands).toContain(mode === "normal" ? "Seite 1, Schritt 1" : "Page 1, step 1");
      }
      const directory = new URL("../../../generated-artifacts/", import.meta.url);
      mkdirSync(directory, { recursive: true });
      writeFileSync(new URL(`synthetic-size-guides-${mode}.pdf`, directory), bytes);
    } finally { globalThis.document = original; }
  });
});

describe("automatic axle references", () => {
  it.each([
    ["Technic Angle Connector #1", "Technic, Axle and Pin Connector Angled #1"],
    ["Technic Axle Joiner Perpendicular", "Technic, Axle and Pin Connector Perpendicular"],
    ["Technic Axle Joiner Inline", "Technic, Axle Connector 2L (Smooth with x Hole)"],
    ["Technic Axle Joiner Inline", "Technic Axle 4"],
    ["Technic Axle and Pin Connector Angled", "Technic Axle and Pin Connector Angled"],
  ])("never turns source/catalog connectors into axle annotations: %s / %s", async (source, catalog) => {
    const document = fixture(), guides: AxleGuideCollection = new Map();
    const part = document.imported!.instances[0];
    document.imported!.resources["parts/half.dat"].content = `0 ${source}\n` +
      document.imported!.resources["parts/half.dat"].content;
    part.part.name = catalog;
    expect(instructionAxle(document, part.reference)).toBeUndefined();
    collectAxleGuides(guides, document, [part.id], "Page 1, step 1");
    expect(guides.size).toBe(0);
    const pdf = new jsPDF({ compress: false });
    await appendAxleGuidePages(pdf, document, guides, "en");
    expect(pdf.getNumberOfPages()).toBe(1);
    expect(pdf.output()).not.toContain("Axle measuring references");
    expect(studioSizeGuideLabels(document, "half.dat")[0]).not.toMatch(/^\d+(?:\.\d+)?L/);
  });

  it("uses actual axle metadata, including flexible axles and half lengths, but not axle connectors", () => {
    const document = fixture();
    const part = document.imported!.instances[0];
    for (const name of ["Technic Axle 5.5 with Stop", "Technic, Axle 5.5", "Technic Axle Flexible 5.5"]) {
      part.part.name = name;
      expect(instructionAxle(document, part.reference)?.length).toBe("5.5L");
    }
    for (const name of ["Technic Axle Pin", "Technic Axle Connector 2", "Brick 1 x 2 with Axle Hole", "Arbitrary Axle 4 label"]) {
      part.part.name = name;
      expect(instructionAxle(document, part.reference)).toBeUndefined();
    }
    part.part.name = "Train Axle Metal 4 x 44";
    expect(instructionAxle(document, part.reference)?.length).toBe("44 mm");
    part.part.status = "missing";
    expect(instructionAxle(document, part.reference)).toMatchObject({ name: "Train Axle Metal 4 x 44", length: undefined });
    // A source title remains evidence even if a catalog mapping/name is missing.
    document.imported!.resources["parts/half.dat"].content = "0 Technic Axle  5.5 with Stop\n" +
      document.imported!.resources["parts/half.dat"].content;
    delete part.part.name;
    expect(instructionAxle(document, part.reference)?.length).toBe("5.5L");
  });

  it("deduplicates native references only when their guides are visible and usable", () => {
    const document = fixture(), guides: AxleGuideCollection = new Map();
    const hidden = node("stop.dat"); hidden.attributes.IsVisible = "False";
    const bad = node("deep.dat", "0 1 0 0");
    const existing = nativeAxleGuideReferences([node("half.dat"), hidden, bad]);
    collectAxleGuides(guides, document, document.imported!.instances.map(part => part.id), "Page 1, step 1", existing);
    expect([...guides.keys()]).toEqual(["stop", "vertical", "deep"]);
    collectAxleGuides(guides, document, [document.imported!.instances[0].id], "Page 2, step 2", existing);
    expect(guides.has("half")).toBe(false);
  });

  it("keeps reused callout occurrences and their step references without duplicate silhouettes", () => {
    const document = fixture(), guides: AxleGuideCollection = new Map();
    document.imported!.instances.forEach(part => { part.sourceOccurrence = [99]; });
    const first = document.imported!.instances[0];
    first.sourceOccurrence = [1, 0];
    const second = { ...first, id: "reused-axle", sourceOccurrence: [2, 0] };
    document.imported!.instances.push(second);
    for (const occurrence of [1, 2]) {
      const step = { id: `step-${occurrence}`, title: "", notes: "", partIds: [],
        callouts: [{ id: `callout-${occurrence}`, title: "", occurrence: [occurrence] }] };
      collectAxleGuides(guides, document, instructionHighlightIds(document, step), `Step ${occurrence}`);
    }
    expect(guides.size).toBe(1);
    expect([...guides.get("half")!.contexts]).toEqual(["Step 1", "Step 2"]);
    expect(guides.has("stop")).toBe(false);
  });

  it.each(["mm", "pt"] as const)("keeps exact physical shapes and a 50 mm control measurement in %s PDFs", async unit => {
    const document = fixture(), guides: AxleGuideCollection = new Map();
    collectAxleGuides(guides, document, document.imported!.instances.map(part => part.id), "Page 33, step 70");
    const pdf = new jsPDF({ unit, compress: false });
    pdf.text("Original diagram page", 10, 10);
    await appendAxleGuidePages(pdf, document, guides, "en");
    expect(pdf.getNumberOfPages()).toBe(2);
    const output = pdf.output();
    expect(output).toContain("/PrintScaling /None");
    expect(output).toContain("Page 33, step 70");
    expect(output).toContain("Control measurement: 50 mm");
    const paths = triangles(output);
    expect(paths).toHaveLength(20);
    const widths = paths.map(t => (Math.max(t[0], t[2], t[4]) - Math.min(t[0], t[2], t[4])) * 25.4 / 72);
    for (const width of [44, 32.8, 24, 20]) expect(widths.some(x => Math.abs(x - width) < 1e-5)).toBe(true);
    const segments = [...output.matchAll(/(-?[\d.]+) (-?[\d.]+) m\s+(-?[\d.]+) (-?[\d.]+) l\s+S/g)];
    expect(segments.some(m => Math.abs((Number(m[3]) - Number(m[1])) * 25.4 / 72 - 50) < 1e-5)).toBe(true);
  });

  it("retains honest nominal lengths when geometry is missing, invalid or too large for the paper", async () => {
    for (const failure of ["missing", "invalid", "too-large"]) {
      const document = fixture(), guides: AxleGuideCollection = new Map();
      const part = document.imported!.instances[0];
      if (failure === "missing") part.part.status = "missing";
      if (failure === "invalid") document.imported!.resources["parts/half.dat"].content = "3 16 NaN 0 0 0 0 0 0 0 0";
      if (failure === "too-large") document.imported!.resources["parts/half.dat"].content = box(0, 0, 0, 3000, 8, 8);
      collectAxleGuides(guides, document, [part.id], "Seite 33, Schritt 70");
      const pdf = new jsPDF({ compress: false });
      await appendAxleGuidePages(pdf, document, guides, "de");
      expect(pdf.output()).toContain("5.5L");
      expect(pdf.output()).toContain("Nur L");
      expect(pdf.output()).not.toContain("1:1) Tj");
      expect(triangles(pdf.output())).toHaveLength(0);
    }
  });

  it("paginates long reference lists without dropping steps or adding empty trailing pages", async () => {
    const document = fixture(), guides: AxleGuideCollection = new Map();
    const ids = [document.imported!.instances[0].id];
    for (let i = 1; i <= 1500; i++) collectAxleGuides(guides, document, ids, `Page ${i}, step ${i}`);
    const pdf = new jsPDF({ compress: false });
    await appendAxleGuidePages(pdf, document, guides, "en");
    expect(pdf.getNumberOfPages()).toBeGreaterThan(2);
    const output = pdf.output();
    expect(output).toContain("step 1500");
    expect(triangles(output)).toHaveLength(4);
    const last = output.slice(output.lastIndexOf("stream\n", output.lastIndexOf("endstream")));
    expect(last).toContain("step 1500");
    expect([...output.matchAll(/Axle measuring references/g)]).toHaveLength(pdf.getNumberOfPages() - 1);
  });

  it("does not add pages when no axles are used and honors cancellation", async () => {
    const pdf = new jsPDF();
    await appendAxleGuidePages(pdf, fixture(), new Map(), "en");
    expect(pdf.getNumberOfPages()).toBe(1);
    const document = fixture(), guides: AxleGuideCollection = new Map();
    collectAxleGuides(guides, document, [document.imported!.instances[0].id], "Step 1");
    await expect(appendAxleGuidePages(pdf, document, guides, "en", AbortSignal.abort())).rejects.toThrow();
  });
});
