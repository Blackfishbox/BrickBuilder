import { readFileSync } from "node:fs";
import { expect, it, vi } from "vitest";
import { createEmptyDocument } from "../editor/model";
import { parseLDraw } from "../formats/ldraw/parser";
import { writeZip } from "../formats/zip";
import { readStudioInstructions } from "./studio";
import { sourceInstructionPlan } from "./model";
import { exportStudioLayoutPDF, partListRect } from "./studio-pdf";
import type { InstructionImageRenderer } from "./render";

const sourceText = [
  "1 4 0 0 0 1 0 0 0 1 0 0 0 1 3004.dat",
  "0 STEP",
  "1 4 40 0 0 1 0 0 0 1 0 0 0 1 3003.dat",
  "0 STEP",
].join("\n");

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

