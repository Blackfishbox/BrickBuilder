import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { Resvg } from "@resvg/resvg-js";
import { expect, it, vi } from "vitest";
import { jsPDF } from "jspdf";
import { unzlibSync } from "fflate";
import { createEmptyDocument } from "../editor/model";
import { parseLDraw } from "../formats/ldraw/parser";
import { writeZip } from "../formats/zip";
import { readStudioInstructions } from "./studio";
import { sourceInstructionPlan } from "./model";
import { exportStudioLayoutPDF, orderStudioPageObjects, partListRect, studioPartCellLayout } from "./studio-pdf";
import type { InstructionImageRenderer } from "./render";
import { editStudioLayout, inspectStudioLayout, studioNodes } from "./studio-layout";
import { studioBufferExchangeArrows, studioCalloutRect, studioModelRect, studioPageArrowPoints, studioTextRect } from "./studio-objects";
import { includeIOAssemblies } from "../formats/io/assemblies";
import { drawStudioArrow } from "./studio-pdf-arrow";
import { createSoftwareInstructionRenderer } from "./software-render";
import { studioSizeGuideLabels } from "./studio-size-guide";
import { exportInstructionPDF } from "./pdf";

const sourceText = [
  "1 4 0 0 0 1 0 0 0 1 0 0 0 1 3004.dat",
  "0 STEP",
  "1 4 40 0 0 1 0 0 0 1 0 0 0 1 3003.dat",
  "0 STEP",
].join("\n");

function nativeFixture(calloutAttributes = "", arrowAttributes = "", extra = "", globalAttributes = "") {
  const xml = `<Instruction><GlobalSetting><PageSetup><PaperType>A4</PaperType><LengthUnit>Millimeters</LengthUnit>
    <Margins>5 5 5 5</Margins></PageSetup><GlobalStyle>
    <StepNumber IsVisible="False"/><PartsList IsVisible="False"/><SubModelPreview IsVisible="False"/>
    <CallOut ${globalAttributes}><Colors IsUseBgColor="True" BgColor="1:0.8:0.6:0.5" IsUseBorder="True"
    BorderColor="0:0:1:1" BorderThickness="0.5" BorderRadius="2"/>
    <Divider IsVisible="True" DividerColor="0:1:0:1" DividerThickness="0.5"/>
    <StepNumber FontFamily="Times" FontStyle="Italic" FontSize="10"/>
    <Multiplier IsVisible="True" FontFamily="Courier" FontStyle="Bold" FontSize="12"/>
    <ArrowStyle Style="TriangleEmpty" Thickness="0.5" Color="1:0:0:0.5"/>
    <Padding LRBT="1 1 1 1"/></CallOut>
    </GlobalStyle></GlobalSetting><Pages><Page template="OneByTwo">
    <Slot Rect="0 0 200 100"><Step SerializedIndex="0"><CallOut>
    <CallOutItemData Rect="-0.4 0.4 0.3 0.6" MultiplierValue="3" MultiplierPosition="0 -1"
    IsUseGlobalStyle="True" CalloutGridMaxPerLine="2" IsCalloutAsRows="True" ${calloutAttributes}>
    <CallOutStepItemData><Step SerializedIndex="0"/><Orientation modelAngle="0 1.5707963267948966 0"/></CallOutStepItemData>
    <CallOutStepItemData><Step SerializedIndex="1"/></CallOutStepItemData>
    <CallOutArrowItemData ArrowPosition="1 0.5 0.1 0" ${arrowAttributes}/>
    </CallOutItemData></CallOut></Step></Slot>
    <Slot Rect="0 100 200 100"><Step SerializedIndex="1"/></Slot>${extra}</Page></Pages></Instruction>`;
  const document = createEmptyDocument("Native Studio");
  document.imported = {
    version: 1, format: "io", sourceName: "native.io", sourceText,
    ...parseLDraw(sourceText), resources: {}, legalDocuments: [],
  };
  document.instructions = readStudioInstructions(xml, sourceInstructionPlan(document.imported));
  const imageBytes = readFileSync(new URL("../../../public/icons/brickbuilder-512.png", import.meta.url));
  const image = `data:image/png;base64,${imageBytes.toString("base64")}`;
  const renderer = { image: vi.fn<InstructionImageRenderer["image"]>(() => image), dispose: vi.fn() };
  return { document, renderer, xml };
}

it("collects new axles from native callout steps even when the parent step adds no axle", async () => {
  const { document, renderer } = nativeFixture();
  document.imported!.instances[1].part.name = "Technic Axle 4 with Stop";
  const bytes = await exportStudioLayoutPDF(document, document.instructions!, { locale: "en" }, async () => renderer);
  const commands = pdfCommands(bytes, true);
  expect(commands).toContain("4L");
  expect(commands).toContain("Page 1, step 1; Page 1, step 2");
  expect(commands).toContain("measuring geometry unavailable");
  expect(Buffer.from(bytes).toString("latin1")).toContain("/Count 2");
  expect(JSON.stringify(document.instructions)).not.toContain("Axle measuring references");
});

it.each(["normal", "studio"])("omits misleading axle lengths and references for connectors in %s PDFs", async mode => {
  const { document, renderer } = nativeFixture();
  const part = document.imported!.instances[1];
  part.part.name = "Technic, Axle and Pin Connector Angled #1";
  document.imported!.resources["parts/3003.dat"] = {
    path: "parts/3003.dat", content: "0 Technic Axle Joiner Perpendicular\n3 16 0 0 0 20 0 0 0 20 0",
    author: "Synthetic fixture", license: "CC0-1.0", sourceUrl: "",
  };
  const bytes = mode === "normal"
    ? await exportInstructionPDF(document, document.instructions!, { locale: "en" }, async () => renderer)
    : await exportStudioLayoutPDF(document, document.instructions!, { locale: "en" }, async () => renderer);
  const commands = pdfCommands(bytes, true);
  expect(commands).not.toContain("Axle measuring references");
  expect(commands).not.toContain("1:1");
  expect(commands).not.toContain(" mm");
  expect(Buffer.from(bytes).toString("latin1")).toContain(`/Count ${mode === "normal" ? 2 : 1}`);
});

it("omits empty trailing Studio slots but retains an intentional blank separator and content pages", async () => {
  const { document, renderer } = nativeFixture();
  const layout = document.instructions!.studioLayout!;
  layout.sourceXml = layout.sourceXml.replace("<Pages>", "<Pages><Page><Slot/></Page>")
    .replace("</Pages>", '<Page><BrickBuilderTitle>Inventory notes</BrickBuilderTitle><Slot/></Page><Page><Slot/></Page><Page><Slot/></Page></Pages>');
  const bytes = await exportStudioLayoutPDF(document, document.instructions!, {}, async () => renderer);
  expect(Buffer.from(bytes).toString("latin1")).toContain("/Count 3");
  const preview = await exportStudioLayoutPDF(document, document.instructions!, { previewPageIndex: 4 }, async () => renderer);
  expect(Buffer.from(preview).toString("latin1")).toContain("/Count 1");
});

it("awaits the recoverable renderer for Studio models, native callouts and subassembly previews", async () => {
  const { document, renderer } = nativeFixture();
  document.instructions!.studioLayout!.sourceXml = document.instructions!.studioLayout!.sourceXml
    .replace('<SubModelPreview IsVisible="False"/>', '<SubModelPreview IsVisible="True"/>');
  document.imported!.instances.forEach((part, index) => { part.sourceOccurrence = [index, 0]; });
  document.instructions!.edited = true;
  document.instructions!.steps[1].callouts = [{ id: "preview", title: "Assembly", occurrence: [0] }];
  const image = renderer.image(new Set(), { id: "fixture", title: "", notes: "", partIds: [] });
  renderer.image.mockClear();
  const imageAsync = vi.fn<NonNullable<InstructionImageRenderer["imageAsync"]>>(async () => {
    await Promise.resolve();
    return image;
  });
  const bytes = await exportStudioLayoutPDF(document, document.instructions!, {},
    async () => ({ ...renderer, imageAsync }));
  expect(bytes.length).toBeGreaterThan(1000);
  expect(renderer.image).not.toHaveBeenCalled();
  expect(imageAsync.mock.calls.length).toBeGreaterThanOrEqual(5);
  expect(imageAsync.mock.calls.some(call => call[1].id === "preview" &&
    call[0].has(document.imported!.instances[0].id))).toBe(true);
  expect(renderer.dispose).toHaveBeenCalledOnce();
});

it("renders only the active Studio subassembly, then mounts every reused occurrence in its parent", async () => {
  const { document, renderer } = nativeFixture();
  const source = [
    "0 FILE main.ldr",
    "1 16 0 0 0 1 0 0 0 1 0 0 0 1 3001.dat", "0 STEP",
    "1 16 80 0 0 1 0 0 0 0 -1 0 1 0 child.ldr", "0 STEP",
    "1 16 160 0 0 1 0 0 0 1 0 0 0 1 child.ldr", "0 STEP",
    "0 FILE child.ldr",
    "1 4 0 0 0 1 0 0 0 1 0 0 0 1 3020.dat", "0 STEP",
    "1 1 0 -8 0 1 0 0 0 1 0 0 0 1 3710.dat", "0 STEP",
  ].join("\n");
  document.imported = { ...document.imported!, sourceText: source, ...parseLDraw(source) };
  const xml = `<Instruction><GlobalSetting><GlobalStyle>
    <PartsList IsVisible="False"/><SubModelPreview IsVisible="False"/>
    </GlobalStyle></GlobalSetting><Pages><Page>${[0, 1, 2, 3, 4].map(index =>
    `<Slot><Step SerializedIndex="${index}"><StepPreview cameraAngle="-0.6154797 0.7853982" modelAngle="0 0 0"/></Step></Slot>`
  ).join("")}</Page></Pages></Instruction>`;
  document.instructions = readStudioInstructions(xml, sourceInstructionPlan(document.imported));
  await exportStudioLayoutPDF(document, document.instructions, { highlight: true }, async () => renderer);
  const calls = renderer.image.mock.calls;
  const [main, a1, a2, b1, b2] = document.imported.instances.map(part => part.id);
  expect(calls.map(call => [...call[0]])).toEqual([
    [main], [a1], [a1, a2], [main, a1, a2], [main, a1, a2, b1, b2],
  ]);
  expect(calls.every(call => call[6]?.silhouetteHighlight && !call[6]?.preserveColors)).toBe(true);
  expect(calls[1][2]).toBeUndefined();
  expect(calls[2][2]).toEqual(new Set([a2]));
  expect(document.imported.instances[1].matrix).toEqual(parseLDraw(source).instances[1].matrix);
});

function pdfCommands(bytes: Uint8Array, includeVectorOnly = false): string {
  const raw = Buffer.from(bytes).toString("latin1");
  return [...raw.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)].map(match => {
    try { return new TextDecoder().decode(unzlibSync(Buffer.from(match[1], "latin1"))); } catch { return ""; }
  }).filter(stream => includeVectorOnly || /\/I\d+ Do/.test(stream)).join("\n");
}

it("exports the right cumulative models after mixed source steps and expanded custom parts", async () => {
  const { document, renderer } = nativeFixture();
  const original = [
    "0 FILE main.ldr",
    "1 15 0 0 0 1 0 0 0 1 0 0 0 1 3001.dat",
    "1 16 80 0 0 1 0 0 0 1 0 0 0 1 child.ldr", "0 STEP",
    "1 16 160 0 0 1 0 0 0 1 0 0 0 1 group.dat", "0 STEP",
    "1 1 200 0 0 1 0 0 0 1 0 0 0 1 3710.dat", "0 STEP",
    "0 FILE child.ldr",
    "1 4 0 0 0 1 0 0 0 1 0 0 0 1 3020.dat", "0 STEP",
  ].join("\n");
  const bytes = new TextEncoder().encode(original);
  const source = new TextDecoder().decode(includeIOAssemblies(bytes, { "group.dat": [
    "0 CustomBrick", "1 71 0 0 0 1 0 0 0 1 0 0 0 1 3020.dat",
    "1 0 0 -8 0 1 0 0 0 1 0 0 0 1 3710.dat",
  ] }));
  document.imported = { ...document.imported!, sourceText: source, ...parseLDraw(source),
    originalBytes: Array.from(writeZip({ "model.ldr": bytes })) };
  const xml = `<Instruction><GlobalSetting><GlobalStyle><PartsList IsVisible="False"/>
    <SubModelPreview IsVisible="False"/></GlobalStyle></GlobalSetting><Pages>${[0, 1, 2, 3].map(index =>
    `<Page><Slot><Step SerializedIndex="${index}"/></Slot></Page>`).join("")}</Pages></Instruction>`;
  document.instructions = readStudioInstructions(xml, sourceInstructionPlan(document.imported));
  await exportStudioLayoutPDF(document, document.instructions, { highlight: true }, async () => renderer);
  const ids = document.imported.instances.map(part => part.id);
  expect(renderer.image.mock.calls.map(call => call[0])).toEqual([
    new Set([ids[1]]), new Set(ids.slice(0, 2)), new Set(ids.slice(0, 4)), new Set(ids),
  ]);
  expect(renderer.image.mock.calls[3][2]).toEqual(new Set([ids[4]]));
});

it("maps native callouts from Studio coordinates and leaves the largest free model area", () => {
  const rect = studioCalloutRect([-0.4, 0.4, 0.3, 0.6], [0, 0, 200, 100]);
  expect(rect[0]).toBeCloseTo(20);
  expect(rect[1]).toBeCloseTo(10);
  expect(rect.slice(2)).toEqual([60, 60]);
  expect(studioModelRect([0, 0, 200, 100], [[0, 0, 60, 100]])).toEqual([60, 0, 140, 100]);
  expect(studioModelRect([0, 0, 200, 100], [])).toEqual([0, 0, 200, 100]);
  expect(studioPageArrowPoints([-10, -20, 30, 40], [10, 20, 200, 100], 2)).toEqual([90, 110, 170, -10]);
  expect(studioTextRect([0.25, 0.25, 30, 10], [10, 20, 200, 100])).toEqual([160, 35, 30, 10]);
});

it("retains decoded source text in page and slot annotations", async () => {
  const { document, renderer } = nativeFixture("", "", '<Text Rect="0 0 40 20" TextValue="On%20both%20sides%21"/>');
  document.instructions!.studioLayout!.sourceXml = document.instructions!.studioLayout!.sourceXml
    .replace('<Step SerializedIndex="1"/></Slot>', '<Step SerializedIndex="1"/><Text Rect="0 0 30 20" TextValue="2x"/></Slot>');
  const bytes = await exportStudioLayoutPDF(document, document.instructions!, {}, async () => renderer);
  const commands = pdfCommands(bytes);
  expect(commands).toContain("(On both sides!)");
  expect(commands).toContain("(2x)");
  expect(commands).not.toContain("%20");
});

it("orders equal-depth page objects by their source order, then keeps insertion order", () => {
  const ordered = orderStudioPageObjects([
    { depth: 2, order: 8, value: "later" },
    { depth: 2, order: 3, value: "first in source" },
    { depth: 1, order: 9, value: "back" },
    { depth: 2, order: 3, value: "same source position" },
  ]);
  expect(ordered.map(object => object.value)).toEqual([
    "back", "first in source", "same source position", "later",
  ]);
});

it("layers transparent Studio images behind and in front of callouts and arrows by depth", async () => {
  const backPath = "ImageResource/back.png", frontPath = "ImageResource/front.png";
  const backImage = `<Image depth="-5" rect="20 10 60 60" opacity="0.5" imagePath="${backPath}"/>`;
  const frontImage = `<Image depth="15" rect="20 10 60 60" opacity="0.4" imagePath="${frontPath}"/>`;
  const pageArrow = '<Arrow Depth="20" PointList="20 10 80 70" EndStyle="TriangleFilled" Color="0 1 0"/>';
  const { document, renderer } = nativeFixture("", "", `${backImage}${frontImage}${pageArrow}`);
  const layout = document.instructions!.studioLayout!;
  layout.sourceXml = layout.sourceXml
    .replace('<Step SerializedIndex="0"><CallOut>', '<Step SerializedIndex="0"><StepPreview Depth="-10"/><CallOut>')
    .replace('CalloutGridMaxPerLine="2"', 'CalloutGridMaxPerLine="2" Depth="0"')
    .replace('<Divider IsVisible="True"', '<Divider IsVisible="False"')
    .replace('ArrowPosition="1 0.5 0.1 0"', 'ArrowPosition="1 0.5 0.1 0" Depth="10"');
  const png = readFileSync(new URL("../../../public/icons/brickbuilder-512.png", import.meta.url));
  document.imported!.originalBytes = Array.from(writeZip({
    "model.ldr": new TextEncoder().encode(sourceText),
    "model.ins": new TextEncoder().encode(layout.sourceXml),
    [backPath]: new Uint8Array(png),
    [frontPath]: new Uint8Array(png),
  }));

  const imageSpy = vi.spyOn(jsPDF.API, "addImage");
  try {
    const bytes = await exportStudioLayoutPDF(document, document.instructions!, {}, async () => renderer);
    const sourceImageIndices = imageSpy.mock.calls.flatMap((call, index) =>
      Number(call[2]) === 20 && Number(call[3]) === 10 && Number(call[4]) === 60 && Number(call[5]) === 60
        ? [index] : []);
    const calloutPreviewIndex = imageSpy.mock.calls.findIndex(call =>
      Number(call[2]) > 20 && Number(call[2]) < 50 && Number(call[3]) > 10 && Number(call[3]) < 40 &&
      Number(call[4]) < 30 && Number(call[5]) < 30);
    const commands = pdfCommands(bytes);
    const drawPositions = [...commands.matchAll(/\/I\d+ Do/g)].map(match => match.index!);
    const calloutArrowPosition = commands.indexOf("1. 0. 0. RG");
    const pageArrowPosition = commands.indexOf("0. 1. 0. RG");

    expect(sourceImageIndices).toHaveLength(2);
    expect(calloutPreviewIndex).toBeGreaterThanOrEqual(0);
    expect(drawPositions).toHaveLength(imageSpy.mock.calls.length);
    expect(drawPositions[sourceImageIndices[0]]).toBeLessThan(drawPositions[calloutPreviewIndex]);
    expect(drawPositions[calloutPreviewIndex]).toBeLessThan(calloutArrowPosition);
    expect(calloutArrowPosition).toBeLessThan(drawPositions[sourceImageIndices[1]]);
    expect(drawPositions[sourceImageIndices[1]]).toBeLessThan(pageArrowPosition);
    expect(new TextDecoder().decode(bytes)).toMatch(/\/ca 0\.4\b/);
    expect(renderer.image.mock.calls[0][3]).toBeCloseTo(1.2);
    expect(renderer.image.mock.calls[3][3]).toBeCloseTo(2);
    expect(renderer.dispose).toHaveBeenCalledOnce();
  } finally {
    imageSpy.mockRestore();
  }
});

it("draws native callout steps, borders, opacity, typography, dividers, multipliers and arrows", async () => {
  const { document, renderer } = nativeFixture();
  const spy = vi.spyOn(jsPDF.API, "addImage");
  const before = JSON.stringify(document);
  try {
    const bytes = await exportStudioLayoutPDF(document, document.instructions!, {}, async () => renderer);
    const commands = pdfCommands(bytes);
    expect(renderer.image).toHaveBeenCalledTimes(4);
    expect(renderer.image.mock.calls[1][1].rotation).toEqual([0, 90, 0]);
    expect(renderer.image.mock.calls[1][1].camera).toBeUndefined();
    expect(renderer.image.mock.calls[1][0].size).toBe(1);
    expect(renderer.image.mock.calls[2][0].size).toBe(2);
    expect(renderer.image.mock.calls.every(call => call[3]! > 0)).toBe(true);
    const calloutImage = spy.mock.calls[1];
    expect(calloutImage[2]).toBeGreaterThanOrEqual(20);
    expect(calloutImage[3]).toBeGreaterThanOrEqual(10);
    expect(Number(calloutImage[2]) + Number(calloutImage[4])).toBeLessThanOrEqual(80);
    expect(Number(calloutImage[3]) + Number(calloutImage[5])).toBeLessThanOrEqual(70);
    expect(commands).toContain("(3");
    expect(commands).toContain("0. 0. 1. RG");
    expect(commands).toContain("1. 0. 0. RG");
    // Two entries in the same row do not get a divider through their images.
    expect(commands).not.toContain("0. 1. 0. RG");
    expect(new TextDecoder().decode(bytes)).toMatch(/\/ca 0\.5/);
    expect(new TextDecoder().decode(bytes)).toContain("/Times-Italic");
    expect(new TextDecoder().decode(bytes)).toContain("/Courier-Bold");
    expect(inspectStudioLayout(document.instructions!.studioLayout!).unsupportedCount).toBe(0);
    expect(JSON.stringify(document)).toBe(before);
  } finally { spy.mockRestore(); }
  expect(renderer.dispose).toHaveBeenCalledOnce();
});

it.each([true, false])("uses the normal PDF's fading and original-color highlight contract in main views and callouts (%s)", async highlight => {
  const { document, renderer } = nativeFixture();
  await exportStudioLayoutPDF(document, document.instructions!, { highlight }, async () => renderer);
  const calls = renderer.image.mock.calls;
  expect(calls).toHaveLength(4);
  expect(calls.every(call => !call[6]?.preserveColors)).toBe(true);
  expect(calls[2][2]).toEqual(highlight ? new Set(document.instructions!.steps[1].partIds) : undefined);
  expect(calls[3][2]).toEqual(highlight ? new Set(document.instructions!.steps[1].partIds) : undefined);
  expect(calls[1][6]?.transparentBackground).toBe(true);
  expect(calls[2][6]?.transparentBackground).toBe(true);
  expect(calls[3][6]?.transparentBackground).not.toBe(true);
});

it("separates callout rows, not the adjacent steps within a row", async () => {
  const { document, renderer } = nativeFixture();
  document.instructions!.studioLayout!.sourceXml =
    document.instructions!.studioLayout!.sourceXml.replace('CalloutGridMaxPerLine="2"', 'CalloutGridMaxPerLine="1"');
  const bytes = await exportStudioLayoutPDF(document, document.instructions!, {}, async () => renderer);
  expect(pdfCommands(bytes)).toContain("0. 1. 0. RG");
});

it.each([
  ['IsVisible="False"', "", ""],
  ["", "", 'IsVisible="False"'],
])("respects native callout visibility without changing the plan", async (attributes, arrowAttributes, globalAttributes) => {
  const { document, renderer } = nativeFixture(attributes, arrowAttributes, "", globalAttributes);
  const bytes = await exportStudioLayoutPDF(document, document.instructions!, {}, async () => renderer);
  expect(renderer.image).toHaveBeenCalledTimes(2);
  expect(pdfCommands(bytes)).not.toContain("1. 0. 0. RG");
});

it("honors arrow visibility and layout edits in the exported appearance", async () => {
  const { document, renderer } = nativeFixture("", 'IsVisible="False"');
  const layout = document.instructions!.studioLayout!;
  const item = studioNodes(layout.sourceXml).find(node => node.name === "CallOutItemData")!;
  document.instructions!.studioLayout = editStudioLayout(layout, item.id, "Rect", "-0.5 0.5 0.2 0.4");
  const spy = vi.spyOn(jsPDF.API, "addImage");
  try {
    const bytes = await exportStudioLayoutPDF(document, document.instructions!, {}, async () => renderer);
    expect(pdfCommands(bytes)).not.toContain("1. 0. 0. RG");
    expect(spy.mock.calls[1][2]).toBeGreaterThanOrEqual(0);
    expect(Number(spy.mock.calls[1][2]) + Number(spy.mock.calls[1][4])).toBeLessThanOrEqual(40);
    expect(Number(spy.mock.calls[1][3]) + Number(spy.mock.calls[1][5])).toBeLessThanOrEqual(40);
  } finally { spy.mockRestore(); }
});

it("draws page arrows from the centered source frame and identifies curved and model-space variants", async () => {
  const arrows = `<Arrow PointList="10 20 30 40" StartStyle="NoHeads" EndStyle="TriangleFilled" Thickness="0.5" Color="0 1 0"/>
    <Arrow PointList="10 20 30 40 50 60" EndStyle="Curved"/>
    <Arrow PointList="20 20 40 40" IsVisible="False" Color="1 0 1"/>`;
  const { document, renderer } = nativeFixture('IsVisible="False"', "", arrows);
  const bytes = await exportStudioLayoutPDF(document, document.instructions!, {}, async () => renderer);
  const commands = pdfCommands(bytes);
  expect(commands).toContain("0. 1. 0. RG");
  expect(commands).not.toContain("1. 0. 1. RG");
  expect(commands).toContain(`${((210 / 2 + 10) * 72 / 25.4).toFixed(16).slice(0, 8)}`);
  expect(inspectStudioLayout(document.instructions!.studioLayout!).unsupportedDetails).toContain("Arrow × 1");
});

it("keeps unsupported native callout arrowheads identified instead of drawing a different shape", () => {
  const { xml } = nativeFixture();
  const layout = { sourceXml: xml.replace('Style="TriangleEmpty"', 'Style="Curved"'), edits: [] };
  expect(inspectStudioLayout(layout).unsupportedDetails).toContain("CallOut × 1");
  const bufferArrow = '<BufferExchange><BufferExchangeItemData showArrow="True"><Arrow PointList="0 0 10 20" EndStyle="TriangleFilled"/></BufferExchangeItemData></BufferExchange>';
  const modelSpace = { sourceXml: xml.replace('<Step SerializedIndex="0"><CallOut>', `<Step SerializedIndex="0">${bufferArrow}<CallOut>`), edits: [] };
  expect(inspectStudioLayout(modelSpace).unsupportedDetails).not.toContain("Arrow × 1");
  const misplaced = { sourceXml: xml.replace('<Step SerializedIndex="0"><CallOut>', '<Step SerializedIndex="0"/><CallOut>')
    .replace('</CallOutItemData></CallOut></Step>', '</CallOutItemData></CallOut>'), edits: [] };
  expect(inspectStudioLayout(misplaced).unsupportedDetails).toContain("CallOut × 1");
});

it("passes visible BufferExchange arrows through the source camera transform", async () => {
  const { document, renderer } = nativeFixture();
  const layout = document.instructions!.studioLayout!;
  layout.sourceXml = layout.sourceXml.replace(
    '<Step SerializedIndex="0"><CallOut>',
    `<Step SerializedIndex="0"><StepPreview cameraAngle="-0.5235988 0.7853982" modelAngle="0 1.5707963 0"
      TargetPos="10 20 30"/><BufferExchange>
      <BufferExchangeItemData showArrow="True" Displacement="2 3 4">
        <Arrow PointList="0 0 0 20" StartStyle="TriangleEmpty" EndStyle="TriangleFilled"
          Thickness="3" Color="1 0 0 0.5"/>
      </BufferExchangeItemData>
      <BufferExchangeItemData showArrow="True" Offset="-2 1 0">
        <Arrow PointList="20 10 20 40" EndStyle="TriangleEmpty" Thickness="1" Color="0 0 1"/>
      </BufferExchangeItemData>
      <BufferExchangeItemData showArrow="False">
        <Arrow PointList="0 0 10 10"/>
      </BufferExchangeItemData>
      </BufferExchange><CallOut>`,
  );
  const nodes = studioNodes(layout.sourceXml);
  const step = nodes.find(node => node.name === "Step" && node.attributes.SerializedIndex === "0")!;
  const arrows = studioBufferExchangeArrows(step, nodes);
  expect(arrows).toHaveLength(2);
  expect(arrows[0]).toMatchObject({
    startStyle: "TriangleEmpty", endStyle: "TriangleFilled", thickness: 3, color: "1 0 0 0.5",
  });
  expect(arrows[1]).toMatchObject({ startStyle: "NoHeads", endStyle: "TriangleEmpty", thickness: 1, color: "0 0 1" });
  expect(arrows[0].points[0]).not.toEqual([10, 20, 30]);
  expect(arrows[0].points[0][0]).toBeCloseTo(0.6);
  expect(arrows[0].points[0][1]).toBeCloseTo(-1.15);
  expect(arrows[0].points[0][2]).toBeCloseTo(-1.7);
  expect(arrows[0].points[1]).not.toEqual(arrows[0].points[0]);
  const unshiftedLayout = { ...layout, sourceXml: layout.sourceXml.replace('Displacement="2 3 4"', "") };
  const unshiftedNodes = studioNodes(unshiftedLayout.sourceXml);
  const unshiftedStep = unshiftedNodes.find(node => node.name === "Step" && node.attributes.SerializedIndex === "0")!;
  const unshiftedArrow = studioBufferExchangeArrows(unshiftedStep, unshiftedNodes)[0];
  arrows[0].points.forEach((point, index) =>
    point.forEach((coordinate, axis) => expect(coordinate - unshiftedArrow.points[index][axis]).toBeCloseTo([0.1, -0.15, -0.2][axis])));
  expect(inspectStudioLayout(layout).unsupportedDetails).not.toContain("Arrow × 1");
  expect(inspectStudioLayout(layout).unsupportedDetails).not.toContain("Arrow × 3");
  await exportStudioLayoutPDF(document, document.instructions!, {}, async () => renderer);
  expect(renderer.image.mock.calls.some(call => call[4]?.length === 2)).toBe(true);
});

it("does not draw exploded-state arrows beside already assembled parts", async () => {
  const { document, renderer } = nativeFixture();
  const layout = document.instructions!.studioLayout!;
  layout.sourceXml = layout.sourceXml.replace('<Step SerializedIndex="0"><CallOut>',
    `<Step SerializedIndex="0"><BufferExchange><BufferExchangeItemData targetPartName="3004.dat"
      showArrow="True" PrevScreenSpacePartStart="-400 -200" PrevScreenSpacePartEnd="-300 -100">
      <Displacement displacement="0 0 80"/><Arrow PointList="-400 -200 -300 -100" Color="1 0 0"/>
      </BufferExchangeItemData></BufferExchange><CallOut>`);
  const nodes = studioNodes(layout.sourceXml), step = nodes.find(node => node.name === "Step")!;
  expect(studioBufferExchangeArrows(step, nodes)).toHaveLength(1);
  expect(studioBufferExchangeArrows(step, nodes, true)).toHaveLength(0);
  await exportStudioLayoutPDF(document, document.instructions!, {}, async () => renderer);
  expect(renderer.image.mock.calls.every(call => !call[4]?.length)).toBe(true);
});

it("includes native axle size-guide labels without claiming a fitted thumbnail is 1:1", async () => {
  const { document, renderer } = nativeFixture();
  const part = document.imported!.instances[0];
  part.reference = "parts/87083.dat";
  part.part.name = "Technic Axle 4 with Stop";
  const guide = '<SizeGuide rect="0.6 0 70 15" Parts="87083.dat 72 91 19&#10;"/>';
  document.instructions!.studioLayout!.sourceXml = document.instructions!.studioLayout!.sourceXml
    .replace('</Slot>', `${guide}</Slot>`);
  expect(studioSizeGuideLabels(document, "87083.dat 72 91 19")).toEqual(["4L · Technic Axle 4 with Stop · 87083"]);
  const commands = pdfCommands(await exportStudioLayoutPDF(document, document.instructions!, {}, async () => renderer));
  expect(commands).toContain("Technic Axle 4 with Stop");
  expect(commands).toContain("87083");
  expect(commands).not.toContain("1:1");
});

it("fails explicitly for an unresolved callout step and disposes the renderer", async () => {
  const { document, renderer } = nativeFixture();
  document.instructions!.studioLayout!.sourceXml = document.instructions!.studioLayout!.sourceXml
    .replace('<CallOutStepItemData><Step SerializedIndex="1"/>', '<CallOutStepItemData><Step SerializedIndex="99"/>');
  await expect(exportStudioLayoutPDF(document, document.instructions!, {}, async () => renderer)).rejects.toThrow(/Bauschritte/);
  expect(renderer.dispose).toHaveBeenCalledOnce();
});

it("draws filled and empty arrowheads, including reversed and vertical arrows", () => {
  const pdf = new jsPDF();
  const triangle = vi.spyOn(pdf, "triangle"), line = vi.spyOn(pdf, "line");
  drawStudioArrow(pdf, [10, 10, 10, 30], "TriangleEmpty", "TriangleFilled", 2, "0:0:1:0.5", 0.5);
  expect(line).toHaveBeenCalledWith(10, 14, 10, 26);
  expect(triangle.mock.calls.map(call => call[6])).toEqual(["D", "FD"]);
  expect(triangle.mock.calls.flatMap(call => call.slice(0, 6)).every(Number.isFinite)).toBe(true);
  drawStudioArrow(pdf, [30, 20, 10, 20], "NoHeads", "TriangleFilled", 1, "0 0 0", 1);
  expect(triangle.mock.calls[2].slice(0, 2)).toEqual([10, 20]);
});

it("honors local callout styling and hidden multipliers while arranging steps in columns", async () => {
  const { document, renderer } = nativeFixture();
  document.instructions!.studioLayout!.sourceXml = document.instructions!.studioLayout!.sourceXml
    .replace('IsUseGlobalStyle="True"', 'IsUseGlobalStyle="False"')
    .replace('IsCalloutAsRows="True"', 'IsCalloutAsRows="False"')
    .replace('<CallOutStepItemData>', `<Colors IsUseBgColor="False" IsUseBorder="True" BorderColor="0:1:1:1" BorderThickness="1"/>
      <Multiplier IsVisible="False"/><StepNumber IsVisible="False"/><CallOutStepItemData>`);
  const spy = vi.spyOn(jsPDF.API, "addImage");
  try {
    const bytes = await exportStudioLayoutPDF(document, document.instructions!, {}, async () => renderer);
    const commands = pdfCommands(bytes);
    expect(commands).toContain("0. 1. 1. RG");
    expect(commands).not.toContain("(3");
    expect(commands).not.toContain("0. 0. 1. RG");
    expect(Number(spy.mock.calls[2][3])).toBeGreaterThan(Number(spy.mock.calls[1][3]));
  } finally { spy.mockRestore(); }
});

it("produces a viewable native-callout PDF with real source geometry through the software renderer", async () => {
  const { document } = nativeFixture();
  document.bricks = [
    { id: "a", type: "brick-2x4", color: "#e53e32", x: 0, y: 0, z: 0, rotation: 0 },
    { id: "b", type: "brick-2x2", color: "#2671c8", x: 0, y: 1.2, z: 0, rotation: 0 },
  ];
  document.imported!.instances = [];
  document.instructions!.steps.forEach((step, index) => { step.partIds = [index ? "b" : "a"]; });
  // A small SVG-backed 2D canvas exercises the real projected triangles and edges,
  // rather than injecting a thumbnail into an otherwise unverified PDF.
  vi.stubGlobal("document", { createElement: () => {
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
      fillRect(x: number, y: number, width: number, height: number) {
        paths = [`<rect x="${x}" y="${y}" width="${width}" height="${height}" fill="${this.fillStyle}"/>`];
      },
    };
    const canvas = {
      width: 0, height: 0, getContext: () => context,
      toDataURL() {
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${this.width}" height="${this.height}">${paths.join("")}</svg>`;
        const png = new Resvg(svg).render().asPng();
        return `data:image/png;base64,${Buffer.from(png).toString("base64")}`;
      },
    };
    return canvas;
  } });
  try {
    const bytes = await exportStudioLayoutPDF(document, document.instructions!, {}, createSoftwareInstructionRenderer);
    const raw = new TextDecoder().decode(bytes);
    expect(raw.match(/\/Subtype \/Image/g)?.length).toBeGreaterThanOrEqual(4);
    expect(raw).toMatch(/\/Count\s+1\b/);
    const directory = new URL("../../../generated-artifacts/", import.meta.url);
    mkdirSync(directory, { recursive: true });
    writeFileSync(new URL("studio-native-callouts.pdf", directory), bytes);
  } finally { vi.unstubAllGlobals(); }
}, 15_000);

it("exports one PDF page per imported Studio page with the source format and step mapping", async () => {
  const imageBytes = readFileSync(new URL("../../../public/icons/brickbuilder-512.png", import.meta.url));
  const xml = `<Instruction>
    <GlobalSetting><PageSetup><PaperType>A4</PaperType><LengthUnit>Pixels</LengthUnit><IsPortrait>False</IsPortrait><Margins>40 40 40 40</Margins></PageSetup>
    <GlobalStyle><Page SlotSpacing="5 6"><Colors IsUseBgColor="True" BgColor="1:1:1:1" IsUseBorder="True" BorderColor="0:0:0:1" BorderThickness="1"/></Page>
    <StepNumber><StepNumber FontFamily="Times New Roman" FontStyle="Italic" FontColor="0.2:0.3:0.4:1" FontSize="24"/></StepNumber>
    <PartsList><Colors IsUseBgColor="True" BgColor="0.7:0.8:0.9:1" IsUseBorder="True" BorderColor="0:0:0:1" BorderThickness="2" BorderRadius="3"/>
    <PartCount FontFamily="Arial" FontStyle="Bold" FontColor="0:0:0:1" FontSize="12"/><Padding LRBT="2 3 4 5"/></PartsList>
    </GlobalStyle></GlobalSetting>
    <Pages>
      <Page template="CustomExample"><Slot><Step SerializedIndex="0" IsVisibleStepNumber="True" IsVisiblePartsList="True" IsVisibleSubModelPreview="False"/><Image rect="10 20 30 40" rotation="0" opacity="0.5" fliped_H="True" fliped_V="True" imagePath="ImageResource/guide.png"/></Slot></Page>
      <Page template="CustomExample"><Slot><Step SerializedIndex="1" IsVisibleStepNumber="True" IsVisiblePartsList="True" IsVisibleSubModelPreview="True"/></Slot></Page>
    </Pages>
    <CustomLayouts><Layout Name="CustomExample"><Slot rect="10 20 300 200"/><Slot rect="400 20 300 200"/></Layout></CustomLayouts>
  </Instruction>`;
  const encode = (value: string) => new TextEncoder().encode(value);
  const imported = {
    version: 1 as const, format: "io" as const, sourceName: "studio.io",
    originalBytes: Array.from(writeZip({
      "model.ldr": encode(sourceText), "model.ins": encode(xml), "ImageResource/guide.png": new Uint8Array(imageBytes),
    })),
    sourceText, ...parseLDraw(sourceText), resources: {}, legalDocuments: [],
  };
  const document = createEmptyDocument("Studio layout");
  document.imported = imported;
  document.instructions = readStudioInstructions(xml, sourceInstructionPlan(imported));
  const image = `data:image/png;base64,${imageBytes.toString("base64")}`;
  const imageCalls: string[] = [], progress: [number, number][] = [];
  const partImageCalls: string[] = [];
  const renderer: InstructionImageRenderer = {
    image(visible, step) { imageCalls.push(step.id); return image; },
    dispose: vi.fn(),
  };

  const bytes = await exportStudioLayoutPDF(document, document.instructions, {
    onProgress: (done, total) => progress.push([done, total]),
  }, async () => renderer, async (_document, entry) => {
    partImageCalls.push(entry.number);
    return image;
  });
  const pdfText = new TextDecoder().decode(bytes);

  expect(pdfText).toMatch(/\/Count\s+2\b/);
  expect(pdfText.match(/\/Subtype \/Image/g)).toHaveLength(2);
  const mediaBox = /\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/.exec(pdfText);
  expect(mediaBox).not.toBeNull();
  expect(Number(mediaBox![1])).toBeCloseTo(841.89, 1);
  expect(Number(mediaBox![2])).toBeCloseTo(595.28, 1);
  expect(pdfText).toMatch(/\/Times-Italic\b/);
  expect(pdfText).toMatch(/\/ca 0\.5\b/);
  expect(imageCalls).toEqual(document.instructions.steps.map(step => step.id));
  expect(partImageCalls).toEqual(["LDraw 3004", "LDraw 3003"]);
  expect(progress).toEqual([[0, 2], [1, 2], [2, 2]]);
  expect(renderer.dispose).toHaveBeenCalledOnce();

  const originalLayoutXml = document.instructions.studioLayout!.sourceXml;
  const previewCalls: string[] = [];
  const previewRenderer: InstructionImageRenderer = {
    image(_visible, step) { previewCalls.push(step.id); return image; },
    dispose: vi.fn(),
  };
  const previewBytes = await exportStudioLayoutPDF(document, document.instructions, {
    previewPageIndex: 1,
  }, async () => previewRenderer, async () => image);
  const previewPdf = new TextDecoder().decode(previewBytes);
  expect(previewPdf).toMatch(/\/Count\s+1\b/);
  expect(previewCalls).toEqual([document.instructions.steps[1].id]);
  expect(previewRenderer.dispose).toHaveBeenCalledOnce();
  expect(document.instructions.studioLayout!.sourceXml).toBe(originalLayoutXml);
});

it("moves a Studio parts box away from an overlapping step name", () => {
  expect(partListRect(
    { quadrant: "LeftTop" },
    { quadrant: "LeftTop" },
    0, 0, 100, 100, 1,
  )).toEqual([66, 0, 34, 27]);
});

it("aligns Studio part labels beside the part image and centers both vertically", () => {
  const cell = studioPartCellLayout(10, 20, 50, 38, 2, 1, 7, 5);
  const numberLineHeight = 7 * 1.15 * 25.4 / 72;
  const colorLineHeight = 5 * 1.15 * 25.4 / 72;
  const labelTop = 20 + (38 - 2 * numberLineHeight - 0.5 - colorLineHeight) / 2;
  const labelBottom = cell.colorY;
  const labelCenter = (labelTop + labelBottom) / 2;
  const imageCenter = cell.imageY + cell.imageSize / 2;

  expect(cell.textX).toBeGreaterThan(cell.imageX + cell.imageSize);
  expect(cell.textWidth).toBeGreaterThan(0);
  expect(cell.numberY).toBeCloseTo(labelTop + numberLineHeight, 8);
  expect(cell.colorY).toBeCloseTo(labelTop + 2 * numberLineHeight + 0.5 + colorLineHeight, 8);
  expect(labelCenter).toBeCloseTo(imageCenter, 8);
});

it("exports the Studio custom paper size using its configured units and orientation", async () => {
  const imageBytes = readFileSync(new URL("../../../public/icons/brickbuilder-512.png", import.meta.url));
  const xml = `<Instruction>
    <GlobalSetting><PageSetup><PaperType>Custom</PaperType><LengthUnit>Pixels</LengthUnit><CustomSize>1190 1684</CustomSize><IsPortrait>False</IsPortrait><Margins>40 40 40 40</Margins></PageSetup></GlobalSetting>
    <Pages><Page template="OneByTwo"><Slot><Step SerializedIndex="0"/></Slot><Slot><Step SerializedIndex="1"/></Slot></Page></Pages>
    <CustomLayouts/>
  </Instruction>`;
  const imported = {
    version: 1 as const, format: "io" as const, sourceName: "custom-paper.io",
    originalBytes: Array.from(writeZip({ "model.ldr": new TextEncoder().encode(sourceText), "model.ins": new TextEncoder().encode(xml) })),
    sourceText, ...parseLDraw(sourceText), resources: {}, legalDocuments: [],
  };
  const document = createEmptyDocument("Custom paper");
  document.imported = imported;
  document.instructions = readStudioInstructions(xml, sourceInstructionPlan(imported));
  const image = `data:image/png;base64,${imageBytes.toString("base64")}`;
  const renderer: InstructionImageRenderer = { image: () => image, dispose: vi.fn() };

  const bytes = await exportStudioLayoutPDF(document, document.instructions, {}, async () => renderer);
  const mediaBox = /\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/.exec(new TextDecoder().decode(bytes));

  expect(mediaBox).not.toBeNull();
  expect(Number(mediaBox![1])).toBeCloseTo(1684, 1);
  expect(Number(mediaBox![2])).toBeCloseTo(1190, 1);
  expect(renderer.dispose).toHaveBeenCalledOnce();
});

it("exports nested Studio slots, source camera framing, and separately numbered callouts", async () => {
  const source = `${sourceText}\n1 0 80 0 0 1 0 0 0 1 0 0 0 1 3004.dat\n0 STEP`;
  const xml = `<Instruction><GlobalSetting><PageSetup><PaperType>Custom</PaperType>
    <LengthUnit>Pixels</LengthUnit><CustomSize>595.2756 841.88983</CustomSize><IsPortrait>False</IsPortrait>
    <Margins>10 10 10 10</Margins></PageSetup><GlobalStyle>
    <Page><Colors IsUseLineSeparatorColumns="True" LineSeperatorColor="0:0:0:1" LineSeperatorThickness="4"/></Page>
    <StepNumber><StepNumber FontSize="60"/></StepNumber><PartsList IsVisible="True"/>
    <StepItemLayout><StepCompLayout><LeftTop>
    <StepCompLayoutElem ComponentT="PartsList" Padding="8 8"/>
    <StepCompLayoutElem ComponentT="StepNumber" Padding="8 8"/></LeftTop></StepCompLayout></StepItemLayout>
    </GlobalStyle></GlobalSetting><Pages><Page template="OneByOne" resizeBars="True -1 -1 0.5">
    <Slot refResizeBarRight="0"><Step SerializedIndex="0">
    <StepPreview cameraAngle="-0.6154797 0.7853982" modelAngle="0 0 0" cameraScale="170"/></Step></Slot>
    <Slot refResizeBarLeft="0"><Step SerializedIndex="2">
    <StepPreview cameraAngle="-3.7570724 2.3561945" modelAngle="0 0 0" cameraScale="170"/>
    <CallOut><CallOutItemData Rect="0.25 0.2 0.2 0.4" IsUseGlobalStyle="True">
    <CallOutStepItemData><Step SerializedIndex="1"/></CallOutStepItemData>
    </CallOutItemData></CallOut></Step></Slot></Page></Pages></Instruction>`;
  const document = createEmptyDocument("Nested layout regression");
  document.imported = { version: 1, format: "io", sourceName: "regression.io", sourceText: source,
    ...parseLDraw(source), resources: {}, legalDocuments: [] };
  document.instructions = readStudioInstructions(xml, sourceInstructionPlan(document.imported));
  const png = `data:image/png;base64,${readFileSync(new URL("../../../public/icons/brickbuilder-512.png", import.meta.url)).toString("base64")}`;
  const renderer = { image: vi.fn<InstructionImageRenderer["image"]>(() => png), dispose: vi.fn() };
  const parts: string[] = [];
  const bytes = await exportStudioLayoutPDF(document, document.instructions, {}, async () => renderer,
    async (_doc, part) => { parts.push(part.number); return png; });
  const commands = pdfCommands(bytes);
  expect(parts).toEqual(["LDraw 3004", "LDraw 3003", "LDraw 3004"]);
  expect(commands).toContain("(2) Tj");
  expect(commands).not.toContain("(3) Tj");
  expect(commands).not.toContain("Teile in diesem Schritt");
  expect(renderer.image.mock.calls.filter(call => call[5] !== undefined)).toHaveLength(2);
  expect(renderer.image.mock.calls[0][1].rotation).not.toEqual([0, 0, 0]);
  // jsPDF transformation matrices use PDF points, not the document's mm units.
  const flips = [...commands.matchAll(/-1\.?0* 0\.?0* 0\.?0* 1\.?0* ([\d.]+) 0\.?0* cm/g)];
  expect(flips).toHaveLength(2);
  expect(Number(flips[1][1])).toBeGreaterThan(842);
  expect(document.instructions.studioLayout!.sourceXml).toBe(xml);
});

