import { afterEach, describe, expect, it, vi } from "vitest";
import { jsPDF } from "jspdf";
import { createEmptyDocument } from "../editor/model";
import { parseLDraw } from "../formats/ldraw/parser";
import { instructionColorLabel, instructionPartDocument, instructionPartGroups, instructionStepNumber } from "./parts";
import { instructionPartImage } from "./part-images";
import { createSoftwareInstructionRenderer } from "./software-render";
import { drawInstructionPartBox } from "./pdf-parts";
import { exportInstructionPDF } from "./pdf";
import type { InstructionPlan, InstructionStep } from "./types";
import { sourceInstructionPlan } from "./model";
import { readFileSync } from "node:fs";

const { pdfTexts } = vi.hoisted(() => ({ pdfTexts: [] as unknown[] }));
vi.mock("jspdf", () => ({
  jsPDF: class {
    private pages = 1;
    private destination?: { push(fragment: string): void };
    __private__ = {
      setCustomOutputDestination: (destination: { push(fragment: string): void }) => { this.destination = destination; },
      resetCustomOutputDestination: () => { this.destination = undefined; },
      buildDocument: () => { this.destination?.push("%PDF-1.4"); return ""; },
    };
    setProperties() {} setDrawColor() {} setFillColor() {} setFont() {} setFontSize() {}
    setTextColor() {} roundedRect() {} addImage() {} setPage() {}
    addPage() { this.pages++; }
    text(value: unknown) { pdfTexts.push(value); }
    splitTextToSize(value: string) { return [value]; }
    getNumberOfPages() { return this.pages; }
    output() { return new TextEncoder().encode("%PDF-1.4").buffer; }
  },
}));
const { gpu } = vi.hoisted(() => ({ gpu: vi.fn((_model: unknown, _code: string): string => { throw new Error("WebGL unavailable"); }) }));
vi.mock("../parts/thumbnails/render", () => ({ renderThumbnail: gpu }));

function fixture() {
  const doc = createEmptyDocument("Parts");
  const line = (color: number, reference: string, x: number) => `1 ${color} ${x} 10 200 0 0 1 0 1 0 -1 0 0 ${reference}`;
  const source = [line(4, "3004.dat", 0), line(4, "3004.dat", 1000), line(1, "3004.dat", 0), line(4, "3003.dat", 0)].join("\n");
  doc.imported = { version: 1, format: "ldr", sourceName: "parts.ldr", sourceText: source, originalBytes: [],
    ...parseLDraw(source), resources: {}, legalDocuments: [] };
  for (const part of doc.imported.instances) {
    part.part.status = "resolved"; part.part.brickLinkId = "3004";
    doc.imported.resources[`parts/${part.reference}`] = {
      path: `parts/${part.reference}`, source: "https://library.ldraw.org",
      content: "0 Test\n3 16 0 0 0 40 0 0 0 24 0\n3 16 0 0 0 0 24 0 0 0 20",
      license: "CC BY 4.0", authors: [], legalTextRefs: [],
    };
  }
  doc.instructions = sourceInstructionPlan(doc.imported);
  return doc;
}
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe("step parts illustrations", () => {
  it("removes underscores from displayed part color names", () => {
    expect(instructionColorLabel("Dark_Green")).toBe("Dark Green");
    expect(instructionColorLabel("Dark_Bluish_Grey")).toBe("Dark Bluish Grey");
  });

  it("formats instruction step headings as numbers without punctuation", () => {
    expect(instructionStepNumber(1)).toBe("1");
    expect(instructionStepNumber(2)).toBe("2");
  });

  it.each([
    { rotation: 135, tiltX: 35, tiltZ: -20 },
    { rotation: 90 },
  ])("resets every local presentation axis without changing the occurrence: %j", pose => {
    const doc = createEmptyDocument("Tilted local part");
    doc.bricks = [{
      id: "tilted", type: "brick-1x2", color: "#d75b3f",
      x: 12, y: 7, z: -4, ...pose,
    }];
    const original = structuredClone(doc);
    const entry = instructionPartGroups(doc, ["tilted"])[0];
    const isolated = instructionPartDocument(doc, entry);
    expect(isolated.bricks).toEqual([{
      ...doc.bricks[0], x: 0, y: 0, z: 0, rotation: 0, tiltX: 0, tiltZ: 0,
    }]);
    expect(isolated.bricks[0]).not.toBe(doc.bricks[0]);
    expect(doc).toEqual(original);
  });

  it("keeps local parts-box images and quantities canonical across build-pose edits", async () => {
    const doc = createEmptyDocument("Local parts box");
    doc.bricks = [
      { id: "first", type: "brick-1x2", color: "#b7c9df", x: 12, y: 7, z: -4, rotation: 135, tiltX: 35, tiltZ: -20 },
      { id: "second", type: "brick-1x2", color: "#b7c9df", x: 0, y: 0, z: 0, rotation: 0 },
    ];
    const original = structuredClone(doc), ids = doc.bricks.map(part => part.id);
    const points: number[] = [], styles: string[] = [];
    const context = { fillStyle: "", globalAlpha: 1, fillRect: vi.fn(), beginPath: vi.fn(), closePath: vi.fn(),
      moveTo: (x: number, y: number) => points.push(x, y), lineTo: (x: number, y: number) => points.push(x, y),
      fill() { styles.push(this.fillStyle); }, stroke() {} };
    const toDataURL = vi.fn(() => "data:image/jpeg;base64,canonical-local");
    vi.stubGlobal("document", { createElement: () => ({ width: 0, height: 0, getContext: () => context, toDataURL }) });
    // Render an independently neutral occurrence, so a cache hit cannot hide an incorrect first image.
    const neutral = createEmptyDocument("Neutral reference");
    neutral.bricks = [{ ...doc.bricks[0], x: 0, y: 0, z: 0, rotation: 0, tiltX: 0, tiltZ: 0 }];
    const renderer = await createSoftwareInstructionRenderer(neutral, undefined, { width: 240, height: 182, minRadius: 0.01 });
    try {
      renderer.image(new Set(["first"]), { id: "part", title: "", notes: "", partIds: ["first"] });
    } finally { renderer.dispose(); }
    const expectedPoints = [...points], expectedStyles = [...styles];
    expect(expectedPoints.length).toBeGreaterThan(0);
    points.length = 0; styles.length = 0;

    const before = instructionPartGroups(doc, ids);
    expect(before).toHaveLength(1);
    expect(before[0].count).toBe(2);
    const signal = new AbortController().signal;
    const image = await instructionPartImage(doc, before[0], signal);
    expect(points).toEqual(expectedPoints);
    expect(styles).toEqual(expectedStyles);
    expect(doc).toEqual(original);

    const moved = structuredClone(doc);
    moved.bricks = moved.bricks.map(part => ({ ...part, x: -20, y: 50, z: 10, rotation: -45, tiltX: -65, tiltZ: 80 }));
    const movedOriginal = structuredClone(moved), after = instructionPartGroups(moved, ids);
    expect(after.map(({ key, count }) => ({ key, count }))).toEqual(before.map(({ key, count }) => ({ key, count })));
    expect(await instructionPartImage(moved, after[0], signal)).toBe(image);
    expect(toDataURL).toHaveBeenCalledTimes(2); // Reference plus first thumbnail; pose edits reuse the image.
    expect(moved).toEqual(movedOriginal);
  });

  it("reuses the shared depth-tested thumbnail renderer with canonical project geometry", async () => {
    const doc = fixture(), original = structuredClone(doc);
    const entry = instructionPartGroups(doc, doc.imported!.instances.map(p => p.id))[0];
    gpu.mockReturnValueOnce("data:image/png;base64,shared-renderer");
    expect(await instructionPartImage(doc, entry, new AbortController().signal)).toBe("data:image/png;base64,shared-renderer");
    expect(gpu).toHaveBeenCalledOnce();
    const [isolated, code] = gpu.mock.calls[0] as [NonNullable<typeof doc.imported>, string];
    expect(isolated.resources).toBe(doc.imported!.resources);
    expect(isolated.instances).toHaveLength(1);
    expect(isolated.instances[0].matrix).toEqual([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0]);
    expect(code).toBe("4");
    expect(doc).toEqual(original);
  });
  it("groups only the selected occurrences, keeping different forms and colors separate", () => {
    const doc = fixture(), ids = doc.imported!.instances.map(p => p.id);
    const groups = instructionPartGroups(doc, [...ids, ids[0], "not-a-part"]);
    expect(groups.map(g => g.count)).toEqual([2, 1, 1]);
    expect(groups.map(g => g.colorName)).toEqual(["Red", "Blue", "Red"]);
    expect(instructionPartGroups(doc, [ids[2]])).toHaveLength(1);
    expect(instructionPartGroups(doc, [])).toEqual([]);
    expect(groups.every(g => !g.number.includes("BrickLink"))).toBe(true);
    const original = structuredClone(doc), isolated = instructionPartDocument(doc, groups[0]);
    expect(isolated.imported!.instances).toHaveLength(1);
    expect(isolated.imported!.instances[0].matrix).toEqual([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0]);
    expect(isolated.imported!.resources).toBe(doc.imported!.resources);
    expect(doc).toEqual(original);
  });

  it("uses real project faces and colors in a bounded, canonical thumbnail without WebGL or fetching", async () => {
    const doc = fixture(), groups = instructionPartGroups(doc, doc.imported!.instances.map(p => p.id));
    const styles: string[] = [], points: number[] = [];
    const context = { fillStyle: "", globalAlpha: 1, fillRect: vi.fn(), beginPath: vi.fn(), closePath: vi.fn(),
      moveTo: (x: number, y: number) => points.push(x, y), lineTo: (x: number, y: number) => points.push(x, y),
      fill() { styles.push(this.fillStyle); }, stroke() {} };
    const canvas = { width: 0, height: 0, getContext: () => context, toDataURL: () => "data:image/jpeg;base64,real-source" };
    vi.stubGlobal("document", { createElement: () => canvas });
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    await instructionPartImage(doc, groups[0], new AbortController().signal);
    expect(styles).toHaveLength(2);
    const red = [...styles]; styles.length = 0;
    await instructionPartImage(doc, groups[1], new AbortController().signal);
    expect(styles).not.toEqual(red);
    expect(points.every(Number.isFinite)).toBe(true);
    expect(points.every((v, index) => v >= 0 && v <= (index % 2 ? 182 : 240))).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
    expect(canvas.width).toBe(1); // Released after each serial job.
    const controller = new AbortController(); controller.abort();
    await expect(instructionPartImage(doc, groups[0], controller.signal)).rejects.toThrow();
  });

  it("marks missing geometry in the PDF instead of drawing an invented part and honors cancellation", async () => {
    const doc = fixture(), groups = instructionPartGroups(doc, doc.imported!.instances.map(p => p.id));
    const pdf = new jsPDF(), text = vi.spyOn(pdf, "text");
    const fail = vi.fn(async () => { throw new Error("missing"); });
    expect(await drawInstructionPartBox(pdf, doc, groups, 24, undefined, fail)).toBe(41);
    expect(text.mock.calls.filter(call => call[0] === "Vorschau fehlt")).toHaveLength(3);
    const controller = new AbortController();
    const abort = vi.fn(async () => { controller.abort(); throw controller.signal.reason; });
    await expect(drawInstructionPartBox(pdf, doc, groups, 24, controller.signal, abort)).rejects.toThrow();
  });

  it("prints color names with spaces in the standard PDF parts box", async () => {
    pdfTexts.length = 0;
    const doc = fixture();
    const entry = instructionPartGroups(doc, [doc.imported!.instances[0].id])[0];
    entry.colorName = "Dark_Green";
    const pdf = new jsPDF();
    await drawInstructionPartBox(pdf, doc, [entry], 24, undefined,
      async () => "data:image/png;base64,fixture", [], undefined, "en");

    expect(JSON.stringify(pdfTexts)).toContain("Dark Green");
    expect(JSON.stringify(pdfTexts)).not.toContain("Dark_Green");
  });

  it("illustrates every group on overflow pages and places its first parts box above the model image", async () => {
    const doc = createEmptyDocument("Many parts");
    doc.bricks = Array.from({ length: 55 }, (_, index) => ({
      id: String(index), type: "brick-1x2" as const, color: `#${index.toString(16).padStart(6, "0")}`,
      x: index, y: 0, z: 0, rotation: 90 as const,
    }));
    const plan = { version: 1 as const, source: "manual" as const, edited: true, warnings: [],
      steps: [{ id: "one", title: "One", notes: "", partIds: doc.bricks.map(p => p.id) }] };
    const png = `data:image/png;base64,${readFileSync(new URL("../../../public/icons/brickbuilder-512.png", import.meta.url)).toString("base64")}`;
    const render = vi.fn(async () => png), dispose = vi.fn(), order: string[] = [];
    render.mockImplementation(async () => { order.push("part"); return png; });
    pdfTexts.length = 0;
    const bytes = await exportInstructionPDF(doc, plan, {}, async () => ({
      image: () => { order.push("model"); return png; }, dispose,
    }), render);
    const strings = pdfTexts.flatMap(value => Array.isArray(value) ? value : [value])
      .filter((value): value is string => typeof value === "string");
    expect(render).toHaveBeenCalledTimes(55);
    expect(order.slice(0, 13)).toEqual([...Array(12).fill("part"), "model"]);
    expect(new TextDecoder().decode(bytes)).toContain("%PDF-1.");
    expect(strings).toContain("Teile in diesem Schritt");
    expect(strings).toContain("1×");
    expect(strings).toContain("LDraw 3004");
    expect(strings).not.toContain("Teile in diesem Schritt · vollständige Angaben");
    expect(strings.every(value => !/^\\d+ × LDraw \\d+ · /.test(value))).toBe(true);
    expect(dispose).toHaveBeenCalledOnce();
  });

  it("localizes instruction labels while showing only step numbers", async () => {
    const doc = createEmptyDocument("English instructions");
    doc.bricks = [{ id: "one", type: "brick-1x2", color: "#d75b3f", x: 0, y: 0, z: 0, rotation: 0 }];
    const plan: InstructionPlan = { version: 1, source: "manual", edited: true, warnings: [], steps: [
      { id: "step", title: "Schritt 1", notes: "", partIds: ["one"] },
    ] };
    const image = `data:image/png;base64,${readFileSync(new URL("../../../public/icons/brickbuilder-512.png", import.meta.url)).toString("base64")}`;
    pdfTexts.length = 0;
    await exportInstructionPDF(doc, plan, { locale: "en" }, async () => ({
      image: () => image, dispose: vi.fn(),
    }), async () => image);
    const strings = pdfTexts.flatMap(value => Array.isArray(value) ? value : [value])
      .filter((value): value is string => typeof value === "string");
    expect(strings).toContain("1");
    expect(strings).not.toContain("1.");
    expect(strings).not.toContain("Step 1");
    expect(strings).not.toContain("Schritt 1");
    expect(strings).toContain("Parts in this step");
    expect(strings).toContain("1 new part · 1 part through this step");
    expect(strings.some(value => /Schritt|Teile|Baugruppen|Vorschau fehlt|Hinweis:/.test(value))).toBe(false);
  });

  it("highlights PDF steps except the first and omits the unsolicited color legend", async () => {
    const doc = createEmptyDocument("Highlighted steps");
    doc.bricks = ["old", "new"].map((id, index) => ({
      id, type: "brick-1x2" as const, color: "#d75b3f", x: index * 2, y: 0, z: 0, rotation: 0 as const,
    }));
    const plan: InstructionPlan = { version: 1, source: "manual", edited: true, warnings: [], steps: [
      { id: "one", title: "One", notes: "", partIds: ["old"] },
      { id: "two", title: "Two", notes: "", partIds: ["new"] },
    ] };
    const image = `data:image/png;base64,${readFileSync(new URL("../../../public/icons/brickbuilder-512.png", import.meta.url)).toString("base64")}`;
    const focusSets: (ReadonlySet<string> | undefined)[] = [];
    const renderModel = vi.fn((_visible: Set<string>, _step: InstructionStep, focus?: ReadonlySet<string>) => {
      focusSets.push(focus);
      return image;
    });
    pdfTexts.length = 0;
    await exportInstructionPDF(doc, plan, { highlight: true }, async () => ({
      image: renderModel, dispose: vi.fn(),
    }));
    expect(focusSets).toEqual([undefined, new Set(["new"])]);
    expect(pdfTexts.some(text => typeof text === "string" && /Türkis|Hellgrau/.test(text))).toBe(false);
  });

  it("exports subassembly callouts as rendered Baugruppen boxes", async () => {
    const doc = createEmptyDocument("Callout");
    const callout = { id: "0/31", title: "window", occurrence: [0, 31] };
    const plan: InstructionPlan = {
      version: 1, source: "ldraw", edited: false, warnings: [],
      steps: [{ id: "insert", title: "Baugruppe einsetzen", notes: "", partIds: [], callouts: [callout] }],
    };
    const image = `data:image/png;base64,${readFileSync(new URL("../../../public/icons/brickbuilder-512.png", import.meta.url)).toString("base64")}`;
    const renderCallout = vi.fn(async () => image);
    const modelRenderer = { image: vi.fn(() => image), dispose: vi.fn() };
    pdfTexts.length = 0;
    const bytes = await exportInstructionPDF(doc, plan, {}, async () => modelRenderer, undefined, renderCallout);
    const strings = pdfTexts.flatMap(value => Array.isArray(value) ? value : [value])
      .filter((value): value is string => typeof value === "string");
    expect(renderCallout).toHaveBeenCalledWith(doc, callout, expect.any(AbortSignal));
    expect(strings).toContain("Teile und Baugruppen in diesem Schritt");
    expect(strings).toContain("window");
    expect(new TextDecoder().decode(bytes)).toContain("%PDF-1.");
  });
});
