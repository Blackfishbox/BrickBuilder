import { XMLParser } from "fast-xml-parser";
import { jsPDF } from "jspdf";
import type { BuilderDocument } from "../editor/model";
import { readZip } from "../formats/zip";
import { instructionPartGroups } from "./parts";
import { instructionCalloutImage, instructionHighlightIds } from "./callouts";
import { createInstructionRenderer, type InstructionImageRenderer } from "./render";
import { inspectStudioLayout } from "./studio-layout";
import type { InstructionPlan, InstructionStep } from "./types";
import type { InstructionPdfOptions } from "./pdf";
import { effectiveInstructions } from "./model";

type XmlRecord = Record<string, unknown>;
type ComponentPlacement = "LeftTop" | "LeftBottom" | "RightTop" | "RightBottom" | "None";
type StudioPageImage = { path: string; rect: [number, number, number, number]; rotation: number; depth: number };
type StudioPdfPage = { source: XmlRecord; images: StudioPageImage[]; steps: {
  source: XmlRecord; planStep: InstructionStep; planIndex: number; placements: Partial<Record<string, ComponentPlacement>>;
}[] };

const asRecord = (value: unknown): XmlRecord | undefined =>
  value && typeof value === "object" && !Array.isArray(value) ? value as XmlRecord : undefined;
const asList = (value: unknown): XmlRecord[] =>
  (Array.isArray(value) ? value : value === undefined ? [] : [value]).map(asRecord).filter((item): item is XmlRecord => !!item);
const text = (value: unknown): string => typeof value === "string" || typeof value === "number" ? String(value) : "";
const attribute = (node: XmlRecord, name: string): string => text(node[`@_${name}`]);

function componentPlacements(layout: unknown): Partial<Record<string, ComponentPlacement>> {
  const record = asRecord(layout);
  const placements: Partial<Record<string, ComponentPlacement>> = {};
  for (const quadrant of ["LeftTop", "LeftBottom", "RightTop", "RightBottom", "None"] as const) {
    const elements = asList(asRecord(record?.[quadrant])?.StepCompLayoutElem);
    for (const element of elements) {
      const component = attribute(element, "ComponentT");
      if (component) placements[component] = quadrant;
    }
  }
  return placements;
}

function studioImageNodes(page: XmlRecord): XmlRecord[] {
  return [
    ...asList(page.Image),
    ...asList(page.Slot).flatMap(slot => asList(slot.Image)),
  ];
}

function componentRect(
  placement: ComponentPlacement | undefined,
  x: number,
  y: number,
  width: number,
  height: number,
): [number, number, number, number] {
  const boxWidth = width * 0.34;
  const boxHeight = height * 0.27;
  if (placement === "None") return [x + (width - boxWidth) / 2, y + (height - boxHeight) / 2, boxWidth, boxHeight];
  const quadrant = placement ?? "LeftTop";
  const left = quadrant.startsWith("Left");
  const top = quadrant.endsWith("Top");
  return [x + (left ? 0 : width - boxWidth), y + (top ? 0 : height - boxHeight), boxWidth, boxHeight];
}

const PAPER_SIZES: Record<string, [number, number]> = {
  A0: [841, 1189], A1: [594, 841], A2: [420, 594], A3: [297, 420], A4: [210, 297], A5: [148, 210],
  Letter: [215.9, 279.4], Legal: [215.9, 355.6], Tabloid: [279.4, 431.8],
};

function studioPages(document: BuilderDocument, input: InstructionPlan): {
  pages: StudioPdfPage[]; size: [number, number]; margins: [number, number, number, number];
  scale: number; imageData: Record<string, { data: string; format: "PNG" | "JPEG" }>;
} {
  const layout = input.studioLayout;
  if (document.imported?.format !== "io" || !layout) throw new Error("Für dieses Projekt gibt es kein importiertes Studio-Seitenlayout.");
  if (!inspectStudioLayout(layout).pages.length) throw new Error("Die IO-Datei enthält keine lesbaren Studio-Seiten.");
  const parsed = new XMLParser({ ignoreAttributes: false, parseTagValue: false, parseAttributeValue: false }).parse(layout.sourceXml);
  const instruction = asRecord(parsed.Instruction);
  const settings = asRecord(asRecord(instruction?.GlobalSetting)?.PageSetup);
  const globalStyle = asRecord(asRecord(instruction?.GlobalSetting)?.GlobalStyle);
  const globalStepLayout = asRecord(globalStyle?.StepItemLayout)?.StepCompLayout;
  const paper = text(settings?.PaperType) || "A4";
  const paperSize = PAPER_SIZES[paper];
  if (!paperSize) throw new Error(`Das Studio-Papierformat „${paper}“ wird für den PDF-Export nicht unterstützt.`);
  const portrait = text(settings?.IsPortrait).toLowerCase() !== "false";
  const size: [number, number] = portrait ? paperSize : [paperSize[1], paperSize[0]];
  const rawMargins = text(settings?.Margins).trim().split(/\s+/).map(Number);
  const marginValues = rawMargins.length === 4 && rawMargins.every(Number.isFinite) ? rawMargins : [40, 40, 40, 40];
  const pxToMm = text(settings?.LengthUnit).toLowerCase() === "pixels" ? 25.4 / 96 : 1;
  const margins = marginValues.map(value => Math.max(0, Math.min(size[0] / 3, value * pxToMm))) as [number, number, number, number];
  const pageNodes = asList(asRecord(instruction?.Pages)?.Page);
  if (!pageNodes.length) throw new Error("Das importierte Studio-Seitenlayout enthält keine Seiten.");

  const pages = pageNodes.map(page => {
    const slots = asList(page.Slot);
    const pageSteps = slots.flatMap(slot => asList(slot.Step).map(source => {
      const sourceIndex = Number(attribute(source, "SerializedIndex"));
      const planIndex = input.steps.findIndex((step, index) => (step.sourceIndex ?? index) === sourceIndex);
      if (!Number.isInteger(sourceIndex) || sourceIndex < 0 || planIndex < 0) {
        throw new Error("Die Studio-Seiten verweisen auf Bauschritte, die nicht eindeutig zum importierten Modell passen.");
      }
      const layout = slot.StepCompLayout ?? globalStepLayout;
      return { source, planStep: input.steps[planIndex], planIndex, placements: componentPlacements(layout) };
    }));
    const images = studioImageNodes(page).flatMap(node => {
      const path = attribute(node, "imagePath");
      const rect = attribute(node, "rect").trim().split(/\s+/).map(Number);
      if (!path || path.length > 300 || /^[a-z][a-z0-9+.-]*:/i.test(path) || path.startsWith("//") ||
          path.includes("\\") || path.split("/").some(segment => segment === "." || segment === "..") ||
          rect.length !== 4 || !rect.every(Number.isFinite) || rect[2] <= 0 || rect[3] <= 0) return [];
      return [{
        path, rect: rect as [number, number, number, number],
        rotation: Number(attribute(node, "rotation")) || 0,
        depth: Number(attribute(node, "depth")) || 0,
      }];
    });
    return { source: page, images, steps: pageSteps };
  });
  const scale = pxToMm;
  const paths = [...new Set(pages.flatMap(page => page.images.map(image => image.path)))];
  const imageData: Record<string, { data: string; format: "PNG" | "JPEG" }> = Object.create(null);
  if (paths.length) {
    const originalBytes = document.imported?.originalBytes;
    if (!originalBytes?.length) throw new Error("Studio-Seitenbilder fehlen im importierten IO-Archiv.");
    const entries = readZip(new Uint8Array(originalBytes), { names: paths, studioEncryption: true });
    for (const path of paths) {
      const entry = Object.entries(entries).find(([name]) => name.toLowerCase() === path.toLowerCase())?.[1];
      if (!entry || entry.length > 8 * 1024 * 1024) throw new Error(`Studio-Seitenbild fehlt oder ist zu groß: ${path}`);
      const format = entry[0] === 0x89 && entry[1] === 0x50 && entry[2] === 0x4e && entry[3] === 0x47
        ? "PNG" : entry[0] === 0xff && entry[1] === 0xd8 && entry[2] === 0xff ? "JPEG" : undefined;
      if (!format) throw new Error(`Studio-Seitenbild hat ein nicht unterstütztes Format: ${path}`);
      let binary = "";
      for (let offset = 0; offset < entry.length; offset += 0x8000) {
        binary += String.fromCharCode(...entry.subarray(offset, Math.min(entry.length, offset + 0x8000)));
      }
      imageData[path] = { data: `data:image/${format.toLowerCase()};base64,${btoa(binary)}`, format };
    }
  }
  return { pages, size, margins, scale, imageData };
}

function fitImage(data: string, x: number, y: number, width: number, height: number, page: jsPDF) {
  const info = page.getImageProperties(data);
  const ratio = Math.min(width / info.width, height / info.height);
  const renderedWidth = info.width * ratio, renderedHeight = info.height * ratio;
  page.addImage(data, data.startsWith("data:image/png") ? "PNG" : "JPEG",
    x + (width - renderedWidth) / 2, y + (height - renderedHeight) / 2, renderedWidth, renderedHeight, undefined, "FAST");
}

function renderStepNumber(pdf: jsPDF, step: InstructionStep, stepNumber: number, x: number, y: number, width: number) {
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(14);
  pdf.setTextColor(30, 42, 38);
  pdf.text(`${stepNumber}. ${step.title}`, x, y, { maxWidth: width });
}

function renderStudioPartList(
  pdf: jsPDF,
  document: BuilderDocument,
  step: InstructionStep,
  x: number,
  y: number,
  width: number,
  height: number,
) {
  const groups = instructionPartGroups(document, step.partIds);
  if (height < 8) return;
  pdf.setDrawColor(180, 184, 176);
  pdf.setFillColor(250, 249, 244);
  pdf.roundedRect(x, y, width, height, 1.5, 1.5, "FD");
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(8);
  pdf.setTextColor(35, 55, 46);
  pdf.text("Teile in diesem Schritt", x + 3, y + 4);
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(Math.max(5.5, Math.min(7, 65 / Math.max(groups.length, 1))));
  const columns = width > 130 ? 2 : 1;
  const rowHeight = Math.max(3.5, Math.min(5, (height - 8) / Math.max(1, Math.ceil(groups.length / columns))));
  groups.slice(0, Math.floor((height - 7) / rowHeight) * columns).forEach((entry, index) => {
    const col = Math.floor(index / Math.max(1, Math.ceil(groups.length / columns)));
    const row = index % Math.max(1, Math.ceil(groups.length / columns));
    const cellWidth = width / columns;
    const label = `${entry.count}× ${entry.number} · ${entry.colorName}`;
    pdf.text(label, x + col * cellWidth + 3, y + 8 + row * rowHeight, { maxWidth: cellWidth - 6 });
  });
  if (groups.length === 0) {
    pdf.setFontSize(7);
    pdf.text("Keine neuen Teile", x + 3, y + 9);
  }
  pdf.setTextColor(0);
}

/** Builds one PDF page for each imported Studio page and uses its original step ordering and page setup. */
export async function exportStudioLayoutPDF(
  document: BuilderDocument,
  input: InstructionPlan,
  options: InstructionPdfOptions = {},
  createRenderer: (document: BuilderDocument, signal?: AbortSignal) => Promise<InstructionImageRenderer> = createInstructionRenderer,
): Promise<Uint8Array> {
  const plan = effectiveInstructions({ ...document, instructions: input });
  const { pages, size, margins, scale, imageData } = studioPages(document, plan);
  options.signal?.throwIfAborted();
  options.onProgress?.(0, pages.length);
  const renderer = await createRenderer(document, options.signal);
  try {
    const [top, right, bottom, left] = margins;
    const pdf = new jsPDF({
      unit: "mm",
      format: size,
      orientation: size[0] > size[1] ? "landscape" : "portrait",
      compress: true,
    });
    pdf.setProperties({ title: `${document.name} – Studio-Seitenlayout`, creator: "BrickBuilder" });
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const contentX = left, contentWidth = Math.max(20, pageWidth - left - right);
    const contentHeight = Math.max(30, pageHeight - top - bottom);

    for (const [pageIndex, sourcePage] of pages.entries()) {
      options.signal?.throwIfAborted();
      if (pageIndex) pdf.addPage(size, size[0] > size[1] ? "landscape" : "portrait");
      const entries = sourcePage.steps;
      const columns = Math.max(1, Math.ceil(Math.sqrt(entries.length)));
      const rows = Math.max(1, Math.ceil(entries.length / columns));
      const gap = 4;
      const cellWidth = (contentWidth - gap * (columns - 1)) / columns;
      const cellHeight = (contentHeight - gap * (rows - 1)) / rows;
      const pageTitle = text(sourcePage.source.BrickBuilderTitle);
      if (pageTitle) {
        pdf.setFont("helvetica", "bold"); pdf.setFontSize(16); pdf.setTextColor(35, 55, 46);
        pdf.text(pageTitle, contentX, top + 5, { maxWidth: contentWidth });
      }

      for (const [cellIndex, entry] of entries.entries()) {
        options.signal?.throwIfAborted();
        const step = entry.planStep;
        const visible = new Set(plan.steps.slice(0, entry.planIndex + 1).flatMap(previous => previous.partIds));
        const col = cellIndex % columns, row = Math.floor(cellIndex / columns);
        const x = contentX + col * (cellWidth + gap);
        const y = top + row * (cellHeight + gap) + (pageTitle ? 8 : 0);
        const stepNode = entry.source;
        const showNumber = attribute(stepNode, "IsVisibleStepNumber").toLowerCase() !== "false";
        const showParts = attribute(stepNode, "IsVisiblePartsList").toLowerCase() !== "false";
        const showCallouts = attribute(stepNode, "IsVisibleSubModelPreview").toLowerCase() !== "false";
        const stepNumber = Number(attribute(stepNode, "SerializedIndex")) + 1;
        const previewHeight = cellHeight - (pageTitle ? 8 : 0);
        const previewY = y + (pageTitle ? 8 : 0);
        const imageY = previewY;
        const highlightIds = options.highlight && entry.planIndex > 0 ? instructionHighlightIds(document, step) : undefined;
        fitImage(renderer.image(visible, step, highlightIds), x, imageY, cellWidth, previewHeight, pdf);
        if (showNumber) {
          const [numberX, numberY, numberWidth] = componentRect(entry.placements.StepNumber, x, imageY, cellWidth, previewHeight);
          renderStepNumber(pdf, step, Number.isFinite(stepNumber) ? stepNumber : entry.planIndex + 1,
            numberX + 2, numberY + 7, Math.max(10, numberWidth - 4));
        }
        if (showParts) {
          const [partsX, partsY, partsWidth, partsHeight] = componentRect(entry.placements.PartsList, x, imageY, cellWidth, previewHeight);
          renderStudioPartList(pdf, document, step, partsX, partsY, partsWidth, partsHeight);
        }
        const callouts = step.callouts ?? [];
        if (showCallouts && callouts.length) {
          const [calloutX, calloutY, calloutWidth, calloutHeight] = componentRect(
            entry.placements.SubModelPreview ?? entry.placements.SubmodelPreview, x, imageY, cellWidth, previewHeight,
          );
          const count = Math.min(callouts.length, 4);
          for (let calloutIndex = 0; calloutIndex < count; calloutIndex++) {
            const col = calloutIndex % 2, row = Math.floor(calloutIndex / 2);
            const thumbWidth = calloutWidth / 2, thumbHeight = calloutHeight / 2;
            const thumb = await instructionCalloutImage(document, callouts[calloutIndex], options.signal ?? new AbortController().signal);
            options.signal?.throwIfAborted();
            fitImage(thumb, calloutX + col * thumbWidth, calloutY + row * thumbHeight, thumbWidth, thumbHeight, pdf);
          }
          if (callouts.length > count) {
            pdf.setFont("helvetica", "bold"); pdf.setFontSize(6); pdf.setTextColor(35, 55, 46);
            pdf.text(`+${callouts.length - count}`, calloutX + calloutWidth - 2, calloutY + calloutHeight - 2, { align: "right" });
          }
        }
      }
      for (const image of sourcePage.images.sort((a, b) => a.depth - b.depth)) {
        options.signal?.throwIfAborted();
        const asset = imageData[image.path];
        const [x, y, width, height] = image.rect.map(value => value * scale);
        pdf.addImage(asset.data, asset.format, x, y, width, height, undefined, "FAST", image.rotation);
      }
      options.onProgress?.(pageIndex + 1, pages.length);
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    return new Uint8Array(pdf.output("arraybuffer"));
  } finally {
    renderer.dispose();
  }
}

export function hasStudioPdfLayout(document: BuilderDocument, plan: InstructionPlan): boolean {
  if (document.imported?.format !== "io" || !plan.studioLayout) return false;
  try {
    return inspectStudioLayout(plan.studioLayout).pages.length > 0;
  } catch {
    return false;
  }
}
