import { XMLParser } from "fast-xml-parser";
import { GState, jsPDF } from "jspdf";
import type { BuilderDocument } from "../editor/model";
import { readZip } from "../formats/zip";
import {
  instructionColorLabel, instructionPartGroups, instructionStepNumber, type InstructionPart,
} from "./parts";
import { instructionPartImage } from "./part-images";
import { instructionCalloutImage, instructionHighlightIds } from "./callouts";
import { createInstructionRenderer, type InstructionImageRenderer } from "./render";
import { inspectStudioLayout } from "./studio-layout";
import type { InstructionPlan, InstructionStep } from "./types";
import type { InstructionPdfOptions } from "./pdf";
import { effectiveInstructions } from "./model";
import { translate, type Locale } from "../../i18n/messages";

type XmlRecord = Record<string, unknown>;
type ComponentPlacement = "LeftTop" | "LeftBottom" | "RightTop" | "RightBottom" | "None";
type ComponentLayout = { quadrant: ComponentPlacement; padding?: [number, number] };
type StudioPageImage = {
  path: string; rect: [number, number, number, number]; rotation: number; depth: number;
  opacity: number; flipH: boolean; flipV: boolean;
};
type StudioColor = { rgb: [number, number, number]; alpha: number };
type StudioBoxStyle = {
  useBackground?: boolean; background?: StudioColor; useBorder?: boolean; border?: StudioColor;
  borderThickness?: number; radius?: number; padding?: [number, number, number, number];
};
type StudioFontStyle = {
  family: "helvetica" | "times" | "courier"; style: "normal" | "bold" | "italic" | "bolditalic";
  size?: number; color?: StudioColor;
};
type StudioPdfStyles = {
  unitScale: number; page: StudioBoxStyle; stepNumber: StudioFontStyle;
  partsList: StudioBoxStyle & { font: StudioFontStyle }; callout: StudioBoxStyle;
  calloutMultiplier: StudioFontStyle; showCalloutMultiplier: boolean;
  pageTitle: StudioFontStyle; stepSpacing?: [number, number];
  showStepNumber: boolean; showPartsList: boolean; showSubmodelPreview: boolean;
};
type StudioPdfPage = { source: XmlRecord; images: StudioPageImage[]; slotRects?: [number, number, number, number][]; steps: {
  source: XmlRecord; planStep: InstructionStep; planIndex: number; placements: Partial<Record<string, ComponentLayout>>;
}[] };

const asRecord = (value: unknown): XmlRecord | undefined =>
  value && typeof value === "object" && !Array.isArray(value) ? value as XmlRecord : undefined;
const asList = (value: unknown): XmlRecord[] =>
  (Array.isArray(value) ? value : value === undefined ? [] : [value]).map(asRecord).filter((item): item is XmlRecord => !!item);
const text = (value: unknown): string => typeof value === "string" || typeof value === "number" ? String(value) : "";
const attribute = (node: XmlRecord, name: string): string => text(node[`@_${name}`]);
const child = (node: XmlRecord | undefined, name: string): XmlRecord | undefined => asRecord(node?.[name]);

function parsedColor(value: unknown): StudioColor | undefined {
  const channels = text(value).trim().split(":").map(Number);
  if (channels.length !== 4 || !channels.every(channel => Number.isFinite(channel) && channel >= 0 && channel <= 1)) return undefined;
  return { rgb: channels.slice(0, 3).map(channel => Math.round(channel * 255)) as [number, number, number], alpha: channels[3] };
}

function studioFont(node: XmlRecord | undefined, fallbackSize: number, fallbackColor: StudioColor): StudioFontStyle {
  const familyName = attribute(node ?? {}, "FontFamily").toLowerCase();
  const family = familyName.includes("times") ? "times" : familyName.includes("courier") ? "courier" : "helvetica";
  const rawStyle = attribute(node ?? {}, "FontStyle").toLowerCase();
  const bold = rawStyle.includes("bold"), italic = rawStyle.includes("italic");
  const size = Number(attribute(node ?? {}, "FontSize"));
  return {
    family,
    style: bold ? (italic ? "bolditalic" : "bold") : (italic ? "italic" : "normal"),
    size: Number.isFinite(size) && size > 0 ? size : fallbackSize,
    color: parsedColor(attribute(node ?? {}, "FontColor")) ?? fallbackColor,
  };
}

function studioBox(node: XmlRecord | undefined): StudioBoxStyle {
  const colors = child(node, "Colors");
  const padding = text(attribute(child(node, "Padding") ?? {}, "LRBT")).trim().split(/\s+/).map(Number);
  const validPadding = padding.length === 4 && padding.every(value => Number.isFinite(value) && value >= 0)
    ? padding as [number, number, number, number] : undefined;
  const thickness = Number(attribute(colors ?? {}, "BorderThickness"));
  const radius = Number(attribute(colors ?? {}, "BorderRadius"));
  return {
    useBackground: attribute(colors ?? {}, "IsUseBgColor").toLowerCase() !== "false",
    background: parsedColor(attribute(colors ?? {}, "BgColor")),
    useBorder: attribute(colors ?? {}, "IsUseBorder").toLowerCase() === "true",
    border: parsedColor(attribute(colors ?? {}, "BorderColor")),
    ...(Number.isFinite(thickness) && thickness >= 0 ? { borderThickness: thickness } : {}),
    ...(Number.isFinite(radius) && radius >= 0 ? { radius } : {}),
    ...(validPadding ? { padding: validPadding } : {}),
  };
}

function studioStyles(globalStyle: XmlRecord | undefined, unitScale: number): StudioPdfStyles {
  const ink = { rgb: [0, 0, 0] as [number, number, number], alpha: 1 };
  const stepNumber = child(globalStyle, "StepNumber");
  const partsList = child(globalStyle, "PartsList");
  const callout = child(globalStyle, "CallOut");
  const submodelPreview = child(globalStyle, "SubModelPreview");
  const page = child(globalStyle, "Page");
  const pageSize = child(page, "Colors");
  const fallbackPartsBackground = { rgb: [250, 249, 244] as [number, number, number], alpha: 1 };
  return {
    unitScale,
    page: {
      useBackground: attribute(pageSize ?? {}, "IsUseBgColor").toLowerCase() === "true",
      background: parsedColor(attribute(pageSize ?? {}, "BgColor")),
      useBorder: attribute(pageSize ?? {}, "IsUseBorder").toLowerCase() === "true",
      border: parsedColor(attribute(pageSize ?? {}, "BorderColor")),
      borderThickness: Number(attribute(pageSize ?? {}, "BorderThickness")) || 0,
      radius: Number(attribute(pageSize ?? {}, "BorderRadius")) || 0,
    },
    stepNumber: studioFont(child(stepNumber, "StepNumber"), 18, ink),
    partsList: {
      ...studioBox(partsList),
      background: parsedColor(attribute(child(partsList, "Colors") ?? {}, "BgColor")) ?? fallbackPartsBackground,
      font: studioFont(child(partsList, "PartCount"), 10, ink),
    },
    callout: studioBox(callout),
    calloutMultiplier: studioFont(child(callout, "Multiplier") ?? child(submodelPreview, "Multiplier"), 12, ink),
    showCalloutMultiplier: attribute(child(callout, "Multiplier") ?? child(submodelPreview, "Multiplier") ?? {}, "IsVisible").toLowerCase() !== "false",
    pageTitle: studioFont(child(child(globalStyle, "PageTitle"), "Font"), 18, ink),
    showStepNumber: attribute(stepNumber ?? {}, "IsVisible").toLowerCase() !== "false",
    showPartsList: attribute(partsList ?? {}, "IsVisible").toLowerCase() !== "false",
    showSubmodelPreview: attribute(child(globalStyle, "SubModelPreview") ?? {}, "IsVisible").toLowerCase() !== "false",
    stepSpacing: (() => {
      const values = text(attribute(page ?? {}, "SlotSpacing")).trim().split(/\s+/).map(Number);
      return values.length === 2 && values.every(value => Number.isFinite(value) && value >= 0)
        ? [values[0] * unitScale, values[1] * unitScale] as [number, number] : undefined;
    })(),
  };
}

function templateGrid(template: string): { columns: number; rows: number } | undefined {
  const words: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };
  const match = /^(one|two|three|four|five|six|\d+)(?:by|x)(one|two|three|four|five|six|\d+)$/i.exec(template);
  if (!match) return undefined;
  const columns = words[match[1].toLowerCase()] ?? Number(match[1]);
  const rows = words[match[2].toLowerCase()] ?? Number(match[2]);
  return columns > 0 && columns <= 8 && rows > 0 && rows <= 8 ? { columns, rows } : undefined;
}

function parseSlotRect(node: XmlRecord): [number, number, number, number] | undefined {
  const raw = attribute(node, "rect") || attribute(node, "Rect") || attribute(node, "LayoutRect");
  const values = raw.trim().split(/\s+/).map(Number);
  if (values.length !== 4 || !values.every(Number.isFinite) || values[2] <= 0 || values[3] <= 0) return undefined;
  return values as [number, number, number, number];
}

function walkRecords(value: unknown, visit: (record: XmlRecord) => void, depth = 0) {
  if (depth > 32 || value === null || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach(item => walkRecords(item, visit, depth + 1));
    return;
  }
  const record = value as XmlRecord;
  visit(record);
  for (const [key, childValue] of Object.entries(record)) {
    if (!key.startsWith("@_")) walkRecords(childValue, visit, depth + 1);
  }
}

function customTemplateSlotRects(customLayouts: XmlRecord | undefined, template: string) {
  let match: XmlRecord | undefined;
  walkRecords(customLayouts, record => {
    if (match) return;
    const names = ["Name", "name", "template", "Template", "LayoutName", "ID", "GUID"]
      .map(name => attribute(record, name));
    if (names.includes(template)) match = record;
  });
  if (!match) return undefined;
  const rects: [number, number, number, number][] = [];
  walkRecords(match, record => {
    const rect = parseSlotRect(record);
    if (rect && rects.length < 64) rects.push(rect);
  });
  return rects.length ? rects : undefined;
}

function componentPlacements(layout: unknown): Partial<Record<string, ComponentLayout>> {
  const record = asRecord(layout);
  const placements: Partial<Record<string, ComponentLayout>> = {};
  for (const quadrant of ["LeftTop", "LeftBottom", "RightTop", "RightBottom", "None"] as const) {
    const elements = asList(asRecord(record?.[quadrant])?.StepCompLayoutElem);
    for (const element of elements) {
      const component = attribute(element, "ComponentT");
      const rawPadding = attribute(element, "Padding").trim().split(/\s+/).map(Number);
      const padding = rawPadding.length === 2 && rawPadding.every(value => Number.isFinite(value) && value >= 0)
        ? rawPadding as [number, number] : undefined;
      if (component) placements[component] = { quadrant, ...(padding ? { padding } : {}) };
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
  placement: ComponentLayout | undefined,
  x: number,
  y: number,
  width: number,
  height: number,
  scale: number,
): [number, number, number, number] {
  const boxWidth = width * 0.34;
  const boxHeight = height * 0.27;
  const quadrant = placement?.quadrant ?? "LeftTop";
  const left = quadrant.startsWith("Left");
  const top = quadrant.endsWith("Top");
  const baseX = quadrant === "None" ? x + (width - boxWidth) / 2 : x + (left ? 0 : width - boxWidth);
  const baseY = quadrant === "None" ? y + (height - boxHeight) / 2 : y + (top ? 0 : height - boxHeight);
  const padX = Math.max(0, (placement?.padding?.[0] ?? 0) * scale);
  const padY = Math.max(0, (placement?.padding?.[1] ?? 0) * scale);
  return [baseX + padX, baseY + padY, Math.max(1, boxWidth - padX * 2), Math.max(1, boxHeight - padY * 2)];
}

function overlapArea(a: [number, number, number, number], b: [number, number, number, number]): number {
  return Math.max(0, Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0])) *
    Math.max(0, Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1]));
}

export function partListRect(
  preferred: ComponentLayout | undefined,
  stepNumber: ComponentLayout | undefined,
  x: number, y: number, width: number, height: number, scale: number,
): [number, number, number, number] {
  const numberRect = componentRect(stepNumber, x, y, width, height, scale);
  const preferredRect = componentRect(preferred, x, y, width, height, scale);
  if (overlapArea(numberRect, preferredRect) === 0) return preferredRect;
  const candidates = ["RightTop", "LeftBottom", "RightBottom", "None"] as const;
  const options = candidates.map(quadrant => componentRect({ quadrant }, x, y, width, height, scale));
  return options.find(rect => overlapArea(numberRect, rect) === 0) ??
    options.reduce((best, rect) => overlapArea(numberRect, rect) < overlapArea(numberRect, best) ? rect : best);
}

const PAPER_SIZES: Record<string, [number, number]> = {
  A0: [841, 1189], A1: [594, 841], A2: [420, 594], A3: [297, 420], A4: [210, 297], A5: [148, 210],
  Letter: [215.9, 279.4], Legal: [215.9, 355.6], Tabloid: [279.4, 431.8],
};

function studioUnitToMm(unit: unknown): number {
  switch (text(unit).trim().toLowerCase()) {
    case "pixel": case "pixels": case "px": return 25.4 / 96;
    case "inch": case "inches": case "in": return 25.4;
    case "centimeter": case "centimeters": case "cm": return 10;
    case "point": case "points": case "pt": return 25.4 / 72;
    case "millimeter": case "millimeters": case "mm": return 1;
    default: return 1;
  }
}

function customPaperSize(value: unknown, unitScale: number): [number, number] | undefined {
  const dimensions = text(value).trim().split(/[\s,;]+/).map(Number);
  if (dimensions.length !== 2 || !dimensions.every(dimension => Number.isFinite(dimension) && dimension > 0)) return undefined;
  const millimeters = dimensions.map(dimension => dimension * unitScale);
  if (millimeters.some(dimension => dimension > 5000)) return undefined;
  return millimeters as [number, number];
}

function studioPages(document: BuilderDocument, input: InstructionPlan, locale: Locale): {
  pages: StudioPdfPage[]; size: [number, number]; margins: [number, number, number, number];
  scale: number; imageData: Record<string, { data: string; format: "PNG" | "JPEG" }>;
  styles: StudioPdfStyles;
} {
  const layout = input.studioLayout;
  if (document.imported?.format !== "io" || !layout) {
    throw new Error(translate(locale, "instruction.pdf.noStudioLayout"));
  }
  if (!inspectStudioLayout(layout).pages.length) {
    throw new Error(translate(locale, "instruction.pdf.noReadableStudioPages"));
  }
  const parsed = new XMLParser({ ignoreAttributes: false, parseTagValue: false, parseAttributeValue: false }).parse(layout.sourceXml);
  const instruction = asRecord(parsed.Instruction);
  const settings = asRecord(asRecord(instruction?.GlobalSetting)?.PageSetup);
  const globalStyle = asRecord(asRecord(instruction?.GlobalSetting)?.GlobalStyle);
  const customLayouts = asRecord(instruction?.CustomLayouts);
  const globalStepLayout = asRecord(globalStyle?.StepItemLayout)?.StepCompLayout;
  const paper = text(settings?.PaperType) || "A4";
  const unitScale = studioUnitToMm(settings?.LengthUnit);
  const paperSize = paper.toLowerCase() === "custom"
    ? customPaperSize(settings?.CustomSize, unitScale)
    : PAPER_SIZES[paper];
  if (!paperSize) {
    if (paper.toLowerCase() === "custom") {
      throw new Error(translate(locale, "instruction.pdf.invalidCustomPaperSize"));
    }
    throw new Error(translate(locale, "instruction.pdf.unsupportedPaper", { paper }));
  }
  const portrait = text(settings?.IsPortrait).toLowerCase() !== "false";
  const size: [number, number] = portrait ? paperSize : [paperSize[1], paperSize[0]];
  const rawMargins = text(settings?.Margins).trim().split(/\s+/).map(Number);
  const marginValues = rawMargins.length === 4 && rawMargins.every(Number.isFinite) ? rawMargins : [40, 40, 40, 40];
  const margins = marginValues.map(value => Math.max(0, Math.min(size[0] / 3, value * unitScale))) as [number, number, number, number];
  const pageNodes = asList(asRecord(instruction?.Pages)?.Page);
  if (!pageNodes.length) throw new Error(translate(locale, "instruction.pdf.noStudioPages"));

  const pages = pageNodes.map(page => {
    const slots = asList(page.Slot);
    const directSlotRects = slots.map(parseSlotRect);
    const template = attribute(page, "template");
    const slotRects = directSlotRects.length && directSlotRects.every((rect): rect is [number, number, number, number] => !!rect)
      ? directSlotRects : customTemplateSlotRects(customLayouts, template);
    const pageSteps = slots.flatMap(slot => asList(slot.Step).map(source => {
      const sourceIndex = Number(attribute(source, "SerializedIndex"));
      const planIndex = input.steps.findIndex((step, index) => (step.sourceIndex ?? index) === sourceIndex);
      if (!Number.isInteger(sourceIndex) || sourceIndex < 0 || planIndex < 0) {
        throw new Error(translate(locale, "instruction.pdf.unmatchedSteps"));
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
        opacity: (() => {
          const value = Number(attribute(node, "opacity"));
          return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 1;
        })(),
        flipH: attribute(node, "fliped_H").toLowerCase() === "true",
        flipV: attribute(node, "fliped_V").toLowerCase() === "true",
      }];
    });
    return { source: page, images, ...(slotRects ? { slotRects } : {}), steps: pageSteps };
  });
  const scale = unitScale;
  const paths = [...new Set(pages.flatMap(page => page.images.map(image => image.path)))];
  const imageData: Record<string, { data: string; format: "PNG" | "JPEG" }> = Object.create(null);
  if (paths.length) {
    const originalBytes = document.imported?.originalBytes;
    if (!originalBytes?.length) throw new Error(translate(locale, "instruction.pdf.missingStudioImages"));
    const entries = readZip(new Uint8Array(originalBytes), { names: paths, studioEncryption: true });
    for (const path of paths) {
      const entry = Object.entries(entries).find(([name]) => name.toLowerCase() === path.toLowerCase())?.[1];
      if (!entry || entry.length > 8 * 1024 * 1024) {
        throw new Error(translate(locale, "instruction.pdf.missingOrLargeStudioImage", { path }));
      }
      const format = entry[0] === 0x89 && entry[1] === 0x50 && entry[2] === 0x4e && entry[3] === 0x47
        ? "PNG" : entry[0] === 0xff && entry[1] === 0xd8 && entry[2] === 0xff ? "JPEG" : undefined;
      if (!format) throw new Error(translate(locale, "instruction.pdf.unsupportedStudioImage", { path }));
      let binary = "";
      for (let offset = 0; offset < entry.length; offset += 0x8000) {
        binary += String.fromCharCode(...entry.subarray(offset, Math.min(entry.length, offset + 0x8000)));
      }
      imageData[path] = { data: `data:image/${format.toLowerCase()};base64,${btoa(binary)}`, format };
    }
  }
  return { pages, size, margins, scale, imageData, styles: studioStyles(globalStyle, unitScale) };
}

function fitImage(data: string, x: number, y: number, width: number, height: number, page: jsPDF) {
  const info = page.getImageProperties(data);
  const ratio = Math.min(width / info.width, height / info.height);
  const renderedWidth = info.width * ratio, renderedHeight = info.height * ratio;
  page.addImage(data, data.startsWith("data:image/png") ? "PNG" : "JPEG",
    x + (width - renderedWidth) / 2, y + (height - renderedHeight) / 2, renderedWidth, renderedHeight, undefined, "FAST");
}

function placeStudioImage(
  pdf: jsPDF,
  data: string,
  format: "PNG" | "JPEG",
  rect: [number, number, number, number],
  image: StudioPageImage,
) {
  const [x, y, width, height] = rect;
  pdf.saveGraphicsState();
  if (image.opacity < 1) pdf.setGState(new GState({ opacity: image.opacity, "stroke-opacity": image.opacity }));
  if (image.flipH || image.flipV) {
    const pageHeight = pdf.internal.pageSize.getHeight();
    const bottom = pageHeight - y - height;
    pdf.setCurrentTransformationMatrix(pdf.Matrix(
      image.flipH ? -1 : 1, 0, 0, image.flipV ? -1 : 1,
      image.flipH ? 2 * x + width : 0,
      image.flipV ? 2 * bottom + height : 0,
    ));
  }
  pdf.addImage(data, format, x, y, width, height, undefined, "FAST", image.rotation);
  pdf.restoreGraphicsState();
}

function drawStyledBox(
  pdf: jsPDF,
  x: number,
  y: number,
  width: number,
  height: number,
  style: StudioBoxStyle,
  scale: number,
  fallbackFill?: StudioColor,
) {
  const background = style.background ?? fallbackFill;
  const fill = style.useBackground === true || (style.useBackground === undefined && !!fallbackFill);
  const border = style.useBorder === true;
  if (!fill && !border) return;
  pdf.saveGraphicsState();
  const fillAlpha = background?.alpha ?? 1, strokeAlpha = style.border?.alpha ?? 1;
  if ((fill && fillAlpha < 1) || (border && strokeAlpha < 1)) {
    pdf.setGState(new GState({
      ...(fill ? { opacity: fillAlpha } : {}),
      ...(border ? { "stroke-opacity": strokeAlpha } : {}),
    }));
  }
  if (background && fill) pdf.setFillColor(...background.rgb);
  if (style.border && border) pdf.setDrawColor(...style.border.rgb);
  else if (border) pdf.setDrawColor(0);
  const thickness = Math.max(0, (style.borderThickness ?? 0.4) * scale);
  const radius = Math.min(width / 2, height / 2, Math.max(0, (style.radius ?? 0) * scale));
  if (border) pdf.setLineWidth(thickness);
  const mode = fill && border ? "FD" : fill ? "F" : "D";
  if (radius > 0) pdf.roundedRect(x, y, width, height, radius, radius, mode);
  else pdf.rect(x, y, width, height, mode);
  pdf.restoreGraphicsState();
}

function withTextOpacity(pdf: jsPDF, color: StudioColor | undefined, draw: () => void) {
  const alpha = color?.alpha ?? 1;
  if (alpha < 1) {
    pdf.saveGraphicsState();
    pdf.setGState(new GState({ opacity: alpha }));
    draw();
    pdf.restoreGraphicsState();
  } else draw();
}

function applyFont(pdf: jsPDF, font: StudioFontStyle, unitScale: number, minimum = 5, maximum = 42) {
  pdf.setFont(font.family, font.style);
  const sourceSize = font.size ?? 12;
  const pointScale = unitScale < 0.5 ? 0.75 : 1;
  pdf.setFontSize(Math.max(minimum, Math.min(maximum, sourceSize * pointScale)));
  pdf.setTextColor(...(font.color?.rgb ?? [0, 0, 0]));
}

function paddingOf(style: StudioBoxStyle, scale: number): [number, number, number, number] {
  return style.padding?.map(value => Math.max(0, Math.min(30, value * scale))) as
    [number, number, number, number] ?? [0, 0, 0, 0];
}

function renderStepNumber(
  pdf: jsPDF,
  stepNumber: number,
  x: number,
  y: number,
  width: number,
  style: StudioFontStyle,
  unitScale: number,
) {
  applyFont(pdf, style, unitScale, 6, 96);
  withTextOpacity(pdf, style.color, () => pdf.text(instructionStepNumber(stepNumber), x, y, { maxWidth: width }));
}

export function studioPartCellLayout(
  cellX: number,
  cellY: number,
  cellWidth: number,
  rowHeight: number,
  numberLineCount: number,
  colorLineCount: number,
  numberFontSize: number,
  colorFontSize: number,
) {
  const imageSize = Math.max(1, Math.min(22, cellWidth * 0.38, rowHeight - 2));
  const imageX = cellX + 1;
  const imageY = cellY + (rowHeight - imageSize) / 2;
  const textX = imageX + imageSize + 2;
  const textWidth = Math.max(1, cellX + cellWidth - 1 - textX);
  const numberLineHeight = numberFontSize * 1.15 * 25.4 / 72;
  const colorLineHeight = colorFontSize * 1.15 * 25.4 / 72;
  const gap = 0.5;
  const numberHeight = numberLineHeight * numberLineCount;
  const colorHeight = colorLineHeight * colorLineCount;
  const blockTop = cellY + (rowHeight - numberHeight - gap - colorHeight) / 2;
  return {
    imageX, imageY, imageSize, textX, textWidth,
    numberY: blockTop + numberLineHeight,
    colorY: blockTop + numberHeight + gap + colorLineHeight,
  };
}

async function renderStudioPartList(
  pdf: jsPDF,
  document: BuilderDocument,
  step: InstructionStep,
  x: number,
  y: number,
  width: number,
  height: number,
  style: StudioPdfStyles["partsList"],
  unitScale: number,
  locale: Locale,
  signal?: AbortSignal,
  renderPart = instructionPartImage,
): Promise<void> {
  const groups = instructionPartGroups(document, step.partIds);
  if (height < 8) return;
  drawStyledBox(pdf, x, y, width, height, style, unitScale,
    style.useBackground === undefined ? { rgb: [250, 249, 244], alpha: 1 } : undefined);
  const [padLeft, padRight, padBottom, padTop] = paddingOf(style, unitScale);
  const left = x + Math.max(2, padLeft), right = Math.max(2, padRight);
  applyFont(pdf, style.font, unitScale, 5, 60);
  withTextOpacity(pdf, style.font.color, () => pdf.text(translate(locale, "instruction.pdf.partsInStep"),
    left, y + padTop + 3.5, { maxWidth: Math.max(10, width - left + x - right) }));
  const contentTop = y + Math.max(7, padTop + 6);
  const contentBottom = y + height - Math.max(2, padBottom);
  if (groups.length === 0) {
    pdf.setFontSize(6);
    withTextOpacity(pdf, style.font.color, () =>
      pdf.text(translate(locale, "instruction.pdf.noNewParts"), left, contentTop + 2));
    pdf.setTextColor(0);
    return;
  }

  const contentHeight = contentBottom - contentTop;
  if (contentHeight <= 0) {
    pdf.setTextColor(0);
    return;
  }
  const innerWidth = Math.max(1, width - left + x - right);
  const columns = innerWidth >= 68 ? 2 : 1;
  const gap = 1;
  const minRowHeight = 14;
  const maxRows = Math.max(1, Math.floor((contentHeight + gap) / (minRowHeight + gap)));
  const totalRows = Math.ceil(groups.length / columns);
  const rows = Math.min(totalRows, maxRows);
  const rowHeight = Math.max(1, (contentHeight - gap * (rows - 1)) / rows);
  const cellWidth = (innerWidth - gap * (columns - 1)) / columns;
  const shown = Math.min(groups.length, rows * columns);
  for (let index = 0; index < shown; index++) {
    signal?.throwIfAborted();
    const entry: InstructionPart = groups[index];
    const col = Math.floor(index / rows);
    const row = index % rows;
    const cellX = left + col * (cellWidth + gap);
    const cellY = contentTop + row * (rowHeight + gap);
    const imageSize = Math.max(1, Math.min(22, cellWidth * 0.38, rowHeight - 2));
    const imageX = cellX + 1, imageY = cellY + (rowHeight - imageSize) / 2;
    try {
      const image = await renderPart(document, entry, signal ?? new AbortController().signal);
      signal?.throwIfAborted();
      fitImage(image, imageX, imageY, imageSize, imageSize, pdf);
    } catch {
      signal?.throwIfAborted();
      pdf.setFont(style.font.family, "normal");
      pdf.setFontSize(5);
      pdf.setTextColor(142, 61, 40);
      pdf.text(translate(locale, "instruction.pdf.previewUnavailable"),
        imageX + imageSize / 2, cellY + rowHeight / 2 + 2, { align: "center", maxWidth: imageSize });
    }

    const bodySize = Math.max(5, Math.min(7, style.font.size ?? 8));
    const colorSize = Math.max(4, Math.min(6, bodySize - 1));
    const textWidth = Math.max(1, cellWidth - imageSize - 4);
    applyFont(pdf, style.font, unitScale, 5, 8);
    pdf.setFontSize(bodySize);
    const number = (pdf.splitTextToSize(`${entry.count}× ${entry.number}`, textWidth) as string[]).slice(0, 2);
    const color = (pdf.splitTextToSize(instructionColorLabel(entry.colorName), textWidth) as string[]).slice(0, 2);
    const layout = studioPartCellLayout(cellX, cellY, cellWidth, rowHeight,
      number.length, color.length, bodySize, colorSize);
    pdf.setFontSize(bodySize);
    withTextOpacity(pdf, style.font.color, () =>
      pdf.text(number, layout.textX, layout.numberY, { maxWidth: layout.textWidth }));
    pdf.setFont(style.font.family, "normal");
    pdf.setFontSize(colorSize);
    withTextOpacity(pdf, style.font.color, () =>
      pdf.text(color, layout.textX, layout.colorY, { maxWidth: layout.textWidth }));
  }
  const overflow = groups.length - shown;
  if (overflow > 0) {
    pdf.setFont(style.font.family, "normal");
    pdf.setFontSize(5);
    withTextOpacity(pdf, style.font.color, () =>
      pdf.text(translate(locale, "instruction.pdf.more", { count: overflow }),
        x + width - right, y + height - Math.max(1, padBottom), { align: "right" }));
  }
  pdf.setTextColor(0);
}

/** Builds one PDF page for each imported Studio page and uses its original step ordering and page setup. */
export async function exportStudioLayoutPDF(
  document: BuilderDocument,
  input: InstructionPlan,
  options: InstructionPdfOptions = {},
  createRenderer: (document: BuilderDocument, signal?: AbortSignal) => Promise<InstructionImageRenderer> = createInstructionRenderer,
  renderPart = instructionPartImage,
): Promise<Uint8Array> {
  const plan = effectiveInstructions({ ...document, instructions: input });
  const locale = options.locale ?? "de";
  const { pages, size, margins, scale, imageData, styles } = studioPages(document, plan, locale);
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
    pdf.setProperties({
      title: `${document.name} – ${translate(locale, "instruction.pdf.studioTitle")}`,
      creator: "BrickBuilder",
    });
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const contentX = left, contentWidth = Math.max(20, pageWidth - left - right);
    const contentHeight = Math.max(30, pageHeight - top - bottom);
    for (const [pageIndex, sourcePage] of pages.entries()) {
      options.signal?.throwIfAborted();
      if (pageIndex) pdf.addPage(size, size[0] > size[1] ? "landscape" : "portrait");
      drawStyledBox(pdf, 0, 0, pageWidth, pageHeight, styles.page, scale);
      const entries = sourcePage.steps;
      const template = attribute(sourcePage.source, "template");
      const grid = templateGrid(template);
      const autoColumns = Math.max(1, Math.ceil(Math.sqrt(entries.length)));
      const columns = grid?.columns ?? autoColumns;
      const rows = Math.max(grid?.rows ?? 1, Math.ceil(entries.length / columns), 1);
      const gapX = Math.min(styles.stepSpacing?.[0] ?? 4, contentWidth / (columns + 1));
      const gapY = Math.min(styles.stepSpacing?.[1] ?? 4, contentHeight / (rows + 1));
      const autoCellWidth = (contentWidth - gapX * (columns - 1)) / columns;
      const autoCellHeight = (contentHeight - gapY * (rows - 1)) / rows;
      const pageTitle = text(sourcePage.source.BrickBuilderTitle);
      if (pageTitle) {
        applyFont(pdf, styles.pageTitle, scale, 8, 60);
        withTextOpacity(pdf, styles.pageTitle.color,
          () => pdf.text(pageTitle, contentX, top + 5, { maxWidth: contentWidth }));
      }

      for (const [cellIndex, entry] of entries.entries()) {
        options.signal?.throwIfAborted();
        const step = entry.planStep;
        const visible = new Set(plan.steps.slice(0, entry.planIndex + 1).flatMap(previous => previous.partIds));
        const col = cellIndex % columns, row = Math.floor(cellIndex / columns);
        const slotRect = sourcePage.slotRects?.[cellIndex];
        const x = slotRect ? slotRect[0] * scale : contentX + col * (autoCellWidth + gapX);
        const y = slotRect ? slotRect[1] * scale : top + row * (autoCellHeight + gapY) + (pageTitle ? 8 : 0);
        const cellWidth = slotRect ? slotRect[2] * scale : autoCellWidth;
        const cellHeight = slotRect ? slotRect[3] * scale : autoCellHeight;
        const stepNode = entry.source;
        const showNumber = styles.showStepNumber && attribute(stepNode, "IsVisibleStepNumber").toLowerCase() !== "false";
        const showParts = styles.showPartsList && attribute(stepNode, "IsVisiblePartsList").toLowerCase() !== "false";
        const showCallouts = styles.showSubmodelPreview && attribute(stepNode, "IsVisibleSubModelPreview").toLowerCase() !== "false";
        const stepNumber = Number(attribute(stepNode, "SerializedIndex")) + 1;
        const previewHeight = cellHeight - (!slotRect && pageTitle ? 8 : 0);
        const previewY = y + (!slotRect && pageTitle ? 8 : 0);
        const imageY = previewY;
        const highlightIds = options.highlight && entry.planIndex > 0 ? instructionHighlightIds(document, step) : undefined;
        fitImage(renderer.image(visible, step, highlightIds), x, imageY, cellWidth, previewHeight, pdf);
        const resolvedStepNumber = Number.isFinite(stepNumber) ? stepNumber : entry.planIndex + 1;
        if (showParts) {
          const [partsX, partsY, partsWidth, partsHeight] = showNumber
            ? partListRect(entry.placements.PartsList, entry.placements.StepNumber, x, imageY, cellWidth, previewHeight, scale)
            : componentRect(entry.placements.PartsList, x, imageY, cellWidth, previewHeight, scale);
          await renderStudioPartList(pdf, document, step, partsX, partsY, partsWidth, partsHeight,
            styles.partsList, styles.unitScale, locale, options.signal, renderPart);
        }
        if (showNumber) {
          const [numberX, numberY, numberWidth] = componentRect(entry.placements.StepNumber, x, imageY, cellWidth, previewHeight, scale);
          renderStepNumber(pdf, resolvedStepNumber,
            numberX + 2, numberY + 7, Math.max(10, numberWidth - 4), styles.stepNumber, scale);
        }
        const callouts = step.callouts ?? [];
        if (showCallouts && callouts.length) {
          const [calloutX, calloutY, calloutWidth, calloutHeight] = componentRect(
            entry.placements.SubModelPreview ?? entry.placements.SubmodelPreview, x, imageY, cellWidth, previewHeight, scale,
          );
          const count = Math.min(callouts.length, 4);
          const [paddingLeft, paddingRight, paddingBottom, paddingTop] = paddingOf(styles.callout, scale);
          for (let calloutIndex = 0; calloutIndex < count; calloutIndex++) {
            const col = calloutIndex % 2, row = Math.floor(calloutIndex / 2);
            const thumbWidth = calloutWidth / 2, thumbHeight = calloutHeight / 2;
            const thumb = await instructionCalloutImage(document, callouts[calloutIndex], options.signal ?? new AbortController().signal);
            options.signal?.throwIfAborted();
            const thumbX = calloutX + col * thumbWidth, thumbY = calloutY + row * thumbHeight;
            drawStyledBox(pdf, thumbX, thumbY, thumbWidth, thumbHeight, styles.callout, scale);
            fitImage(thumb, thumbX + paddingLeft, thumbY + paddingTop,
              Math.max(1, thumbWidth - paddingLeft - paddingRight),
              Math.max(1, thumbHeight - paddingTop - paddingBottom), pdf);
            const multiplier = callouts[calloutIndex].occurrence.length;
            if (styles.showCalloutMultiplier && multiplier > 1) {
              const font = styles.calloutMultiplier;
              applyFont(pdf, font, scale, 5, 60);
              withTextOpacity(pdf, font.color, () =>
                pdf.text(`${multiplier}×`, thumbX + thumbWidth - 2, thumbY + thumbHeight - 2, { align: "right" }));
            }
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
        placeStudioImage(pdf, asset.data, asset.format, [x, y, width, height], image);
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
    return inspectStudioLayout(plan.studioLayout).pages.some(page => new Set(page.steps).size > 1);
  } catch {
    return false;
  }
}
