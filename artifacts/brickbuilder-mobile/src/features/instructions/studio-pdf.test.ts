import { readFileSync } from "node:fs";
import { expect, it, vi } from "vitest";
import { createEmptyDocument } from "../editor/model";
import { parseLDraw } from "../formats/ldraw/parser";
import { writeZip } from "../formats/zip";
import { readStudioInstructions } from "./studio";
import { sourceInstructionPlan } from "./model";
import { exportStudioLayoutPDF } from "./studio-pdf";
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
    <GlobalSetting><PageSetup><PaperType>A4</PaperType><LengthUnit>Pixels</LengthUnit><IsPortrait>False</IsPortrait><Margins>40 40 40 40</Margins></PageSetup></GlobalSetting>
    <Pages>
      <Page template="OneByOne"><Slot><Step SerializedIndex="0" IsVisibleStepNumber="True" IsVisiblePartsList="True" IsVisibleSubModelPreview="False"/><Image rect="10 20 30 40" rotation="0" imagePath="ImageResource/guide.png"/></Slot></Page>
      <Page template="OneByOne"><Slot><Step SerializedIndex="1" IsVisibleStepNumber="True" IsVisiblePartsList="True" IsVisibleSubModelPreview="True"/></Slot></Page>
    </Pages>
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
  const renderer: InstructionImageRenderer = {
    image(visible, step) { imageCalls.push(step.id); return image; },
    dispose: vi.fn(),
  };

  const bytes = await exportStudioLayoutPDF(document, document.instructions, {
    onProgress: (done, total) => progress.push([done, total]),
  }, async () => renderer);
  const pdfText = new TextDecoder().decode(bytes);

  expect(pdfText).toMatch(/\/Count\s+2\b/);
  expect(pdfText.match(/\/Subtype \/Image/g)).toHaveLength(2);
  const mediaBox = /\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/.exec(pdfText);
  expect(mediaBox).not.toBeNull();
  expect(Number(mediaBox![1])).toBeCloseTo(841.89, 1);
  expect(Number(mediaBox![2])).toBeCloseTo(595.28, 1);
  expect(imageCalls).toEqual(document.instructions.steps.map(step => step.id));
  expect(progress).toEqual([[0, 2], [1, 2], [2, 2]]);
  expect(renderer.dispose).toHaveBeenCalledOnce();
});

