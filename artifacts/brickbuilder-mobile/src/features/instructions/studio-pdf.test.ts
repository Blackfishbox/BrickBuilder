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
import { studioBufferExchangeArrows, studioCalloutRect, studioModelRect } from "./studio-objects";
import { drawStudioArrow } from "./studio-pdf-arrow";
import { createSoftwareInstructionRenderer } from "./software-render";

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

function pdfCommands(bytes: Uint8Array): string {
  const raw = Buffer.from(bytes).toString("latin1");
  return [...raw.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)].map(match => {
    try { return new TextDecoder().decode(unzlibSync(Buffer.from(match[1], "latin1"))); } catch { return ""; }
  }).filter(stream => /\/I\d+ Do/.test(stream)).join("\n");
}

it("maps native callouts from Studio coordinates and leaves the largest free model area", () => {
  const rect = studioCalloutRect([-0.4, 0.4, 0.3, 0.6], [0, 0, 200, 100]);
  expect(rect[0]).toBeCloseTo(20);
  expect(rect[1]).toBeCloseTo(10);
  expect(rect.slice(2)).toEqual([60, 60]);
  expect(studioModelRect([0, 0, 200, 100], [[0, 0, 60, 100]])).toEqual([60, 0, 140, 100]);
  expect(studioModelRect([0, 0, 200, 100], [])).toEqual([0, 0, 200, 100]);
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
    expect(commands).toContain("0. 1. 0. RG");
    expect(new TextDecoder().decode(bytes)).toMatch(/\/ca 0\.5/);
    expect(new TextDecoder().decode(bytes)).toContain("/Times-Italic");
    expect(new TextDecoder().decode(bytes)).toContain("/Courier-Bold");
    expect(inspectStudioLayout(document.instructions!.studioLayout!).unsupportedCount).toBe(0);
    expect(JSON.stringify(document)).toBe(before);
  } finally { spy.mockRestore(); }
  expect(renderer.dispose).toHaveBeenCalledOnce();
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

it("draws page arrows in source units and identifies curved and model-space variants", async () => {
  const arrows = `<Arrow PointList="10 20 30 40" StartStyle="NoHeads" EndStyle="TriangleFilled" Thickness="0.5" Color="0 1 0"/>
    <Arrow PointList="10 20 30 40 50 60" EndStyle="Curved"/>
    <Arrow PointList="20 20 40 40" IsVisible="False" Color="1 0 1"/>`;
  const { document, renderer } = nativeFixture('IsVisible="False"', "", arrows);
  const bytes = await exportStudioLayoutPDF(document, document.instructions!, {}, async () => renderer);
  const commands = pdfCommands(bytes);
  expect(commands).toContain("0. 1. 0. RG");
  expect(commands).not.toContain("1. 0. 1. RG");
  expect(commands).toContain(`${(10 * 72 / 25.4).toFixed(16).slice(0, 8)}`);
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
  expect(arrows[0].points[1]).not.toEqual(arrows[0].points[0]);
  const unshiftedLayout = { ...layout, sourceXml: layout.sourceXml.replace('Displacement="2 3 4"', "") };
  const unshiftedNodes = studioNodes(unshiftedLayout.sourceXml);
  const unshiftedStep = unshiftedNodes.find(node => node.name === "Step" && node.attributes.SerializedIndex === "0")!;
  const unshiftedArrow = studioBufferExchangeArrows(unshiftedStep, unshiftedNodes)[0];
  arrows[0].points.forEach((point, index) =>
    point.forEach((coordinate, axis) => expect(coordinate - unshiftedArrow.points[index][axis]).toBeCloseTo([2, 3, 4][axis])));
  expect(inspectStudioLayout(layout).unsupportedDetails).not.toContain("Arrow × 1");
  expect(inspectStudioLayout(layout).unsupportedDetails).not.toContain("Arrow × 3");
  await exportStudioLayoutPDF(document, document.instructions!, {}, async () => renderer);
  expect(renderer.image.mock.calls.some(call => call[4]?.length === 2)).toBe(true);
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
});

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
  expect(Number(mediaBox![1])).toBeCloseTo(1263, 1);
  expect(Number(mediaBox![2])).toBeCloseTo(892.5, 1);
  expect(renderer.dispose).toHaveBeenCalledOnce();
});

