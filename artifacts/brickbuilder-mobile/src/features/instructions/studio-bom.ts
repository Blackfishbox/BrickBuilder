import type { jsPDF } from "jspdf";
import type { BuilderDocument } from "../editor/model";
import { translate, type Locale } from "../../i18n/messages";
import { instructionColorLabel, instructionPartGroups, type InstructionPart } from "./parts";
import { studioPartImage } from "./studio-parts-image";
import type { InstructionPartImageSize } from "./part-images";
import { partProjectedSize } from "./part-projection";
import { studioChildren, type StudioRect } from "./studio-objects";
import type { StudioNode } from "./studio-layout";

interface BomCell {
  part: InstructionPart;
  x: number; y: number; width: number; height: number;
  imageWidth: number; imageHeight: number;
  lines: string[];
}
export interface StudioBomPage {
  cells: BomCell[];
  fontSize: number;
  fontStyle: "normal" | "bold" | "italic" | "bolditalic";
  color: [number, number, number];
  rect: StudioRect;
  background?: [number, number, number];
}

function positive(value: string | undefined, fallback: number, min: number, max: number): number {
  const number = Number(value);
  return value !== undefined && Number.isFinite(number) && number > 0 ? Math.max(min, Math.min(max, number)) : fallback;
}

/** Inventory identity does not change when only one occurrence lacks geometry. */
export function studioBomParts(document: BuilderDocument): InstructionPart[] {
  const ids = [...document.bricks.map(part => part.id), ...(document.imported?.instances.map(part => part.id) ?? [])];
  const groups = new Map<string, InstructionPart>();
  for (const part of instructionPartGroups(document, ids)) {
    const key = JSON.stringify(part.kind === "imported"
      ? ["imported", part.part.reference.toLowerCase().replaceAll("\\", "/"), part.part.colorCode, part.colorHex]
      : ["legacy", part.part.type, part.colorHex.toLowerCase()]);
    const previous = groups.get(key);
    if (previous) {
      previous.count += part.count;
      if (previous.kind === "imported" && previous.part.part.status !== "resolved" &&
          part.kind === "imported" && part.part.part.status === "resolved") {
        groups.set(key, { ...part, count: previous.count });
      }
    } else groups.set(key, { ...part });
  }
  return [...groups.values()];
}

function imageDimensions(document: BuilderDocument, part: InstructionPart, scale: number): [number, number] {
  try {
    const size = partProjectedSize(document, part);
    if (size) return [size[0] * scale, size[1] * scale];
  } catch { /* Keep an explicit unavailable-preview message and the inventory entry. */ }
  return [20 * scale, 16 * scale];
}

const STUDIO_BOM_IMAGE_DPI = 180;
const STUDIO_BOM_MAX_IMAGE_EDGE = 768;

export function studioBomRasterSize(widthMm: number, heightMm: number): InstructionPartImageSize {
  const scale = Math.min(STUDIO_BOM_IMAGE_DPI / 25.4, STUDIO_BOM_MAX_IMAGE_EDGE / Math.max(widthMm, heightMm));
  return {
    width: Math.max(1, Math.ceil(widthMm * scale)),
    height: Math.max(1, Math.ceil(heightMm * scale)),
  };
}

function rgb(raw: string | undefined): [number, number, number] | undefined {
  const values = raw?.split(":").map(Number);
  return values?.length === 4 && values.every(value => Number.isFinite(value) && value >= 0 && value <= 1)
    ? values.slice(0, 3).map(value => Math.round(value * 255)) as [number, number, number] : undefined;
}

/** Plan the whole inventory first; no group is dropped when a page fills up. */
export function planStudioBom(
  pdf: jsPDF, document: BuilderDocument, bom: StudioNode, nodes: StudioNode[],
  contentRect: StudioRect, unitScale: number, locale: Locale, signal?: AbortSignal,
): StudioBomPage[] {
  signal?.throwIfAborted();
  const label = studioChildren(bom, nodes, "Label")[0]?.attributes ?? {};
  const partSize = studioChildren(bom, nodes, "PartSize")[0]?.attributes ?? {};
  const padding = studioChildren(bom, nodes, "Padding")[0]?.attributes.LRBT?.split(/\s+/).map(Number);
  const colors = studioChildren(bom, nodes, "Colors")[0]?.attributes ?? {};
  const [left, right, bottom, top] = padding?.length === 4 && padding.every(value => Number.isFinite(value) && value >= 0)
    ? padding.map(value => value * unitScale) : [2, 2, 2, 2];
  let [x, y, width, height] = contentRect;
  if (bom.attributes.useCostomizeContentRect?.toLowerCase() === "true") {
    const rect = bom.attributes.rect?.trim().split(/\s+/).map(Number);
    if (rect?.length === 4 && rect.every(Number.isFinite) && rect[2] > 0 && rect[3] > 0) {
      const rx = Math.max(0, rect[0] * unitScale), ry = Math.max(0, rect[1] * unitScale);
      x += rx; y += ry;
      width = Math.min(width - rx, rect[2] * unitScale);
      height = Math.min(height - ry, rect[3] * unitScale);
    }
  }
  const rect: StudioRect = [x, y, width, height];
  x += left; y += top; width -= left + right; height -= top + bottom;
  const fontSize = positive(label.FontSize, 10, 5, 24);
  const rawStyle = label.FontStyle?.toLowerCase() ?? "";
  const fontStyle = rawStyle.includes("bold")
    ? rawStyle.includes("italic") ? "bolditalic" : "bold"
    : rawStyle.includes("italic") ? "italic" : "normal";
  pdf.setFont("helvetica", fontStyle); pdf.setFontSize(fontSize);
  const lineHeight = fontSize * 25.4 / 72 * 1.15;
  if (width < 12 || height < lineHeight * 3 + 5) throw new Error(translate(locale, "instruction.pdf.bomTooSmall"));
  const imageScale = positive(partSize.Scale, 1, 0.1, 4);
  const collator = new Intl.Collator(locale, { numeric: true, sensitivity: "base" });
  const entries = studioBomParts(document).map(part => {
    signal?.throwIfAborted();
    const [imageWidth, imageHeight] = imageDimensions(document, part, imageScale);
    return { part, imageWidth, imageHeight };
  });
  const order = bom.attributes.OrderBy ?? "Color_Size_Ascending";
  const descending = /descending/i.test(order) ? -1 : 1;
  entries.sort((a, b) => {
    const color = collator.compare(instructionColorLabel(a.part.colorName), instructionColorLabel(b.part.colorName));
    const size = a.imageWidth * a.imageHeight - b.imageWidth * b.imageHeight;
    return descending * (/^size/i.test(order) ? size || color : color || size) ||
      collator.compare(a.part.number, b.part.number);
  });
  const makePage = (): StudioBomPage => ({
    cells: [], fontSize, fontStyle, color: rgb(label.FontColor) ?? [0, 0, 0], rect,
    ...(colors.IsUseBgColor?.toLowerCase() === "true" && rgb(colors.BgColor) ? { background: rgb(colors.BgColor) } : {}),
  });
  const pages = [makePage()];
  const asRows = bom.attributes.IsShownAsRow?.toLowerCase() === "true";
  let cursorX = 0, cursorY = 0, stripSize = 0;
  const gap = 3;
  const labels = (part: InstructionPart, cellWidth: number): string[] => [
    ...pdf.splitTextToSize(`${new Intl.NumberFormat(locale).format(part.count)}x`, cellWidth - 2) as string[],
    ...pdf.splitTextToSize(part.number.replace(/^LDraw\s+/, ""), cellWidth - 2) as string[],
    ...pdf.splitTextToSize(instructionColorLabel(part.colorName), cellWidth - 2) as string[],
  ];
  // If one part cannot fit the page, reduce the ENTIRE inventory, across every
  // continuation page. Never enlarge small pins or shrink long beams separately.
  const maxLabelHeight = entries.reduce((maximum, entry) => Math.max(maximum,
    labels(entry.part, Math.min(width, 22)).length * lineHeight + 2), lineHeight * 3 + 2);
  if (maxLabelHeight + 4 > height) throw new Error(translate(locale, "instruction.pdf.bomTooSmall"));
  const commonScale = entries.reduce((fit, entry) => Math.min(fit,
    (width - 2) / entry.imageWidth, (height - maxLabelHeight) / entry.imageHeight), 1);
  for (const entry of entries) {
    signal?.throwIfAborted();
    const imageWidth = entry.imageWidth * commonScale, imageHeight = entry.imageHeight * commonScale;
    const cellWidth = Math.min(width, Math.max(22, imageWidth + 2));
    const lines = labels(entry.part, cellWidth);
    const labelHeight = lines.length * lineHeight + 2;
    if (labelHeight + 4 > height) throw new Error(translate(locale, "instruction.pdf.bomTooSmall"));
    const cellHeight = imageHeight + labelHeight;
    if (asRows ? cursorX + cellWidth > width + 1e-6 : cursorY + cellHeight > height + 1e-6) {
      if (asRows) { cursorY += stripSize + gap; cursorX = 0; }
      else { cursorX += stripSize + gap; cursorY = 0; }
      stripSize = 0;
    }
    if (cursorX + cellWidth > width + 1e-6 || cursorY + cellHeight > height + 1e-6) {
      pages.push(makePage()); cursorX = 0; cursorY = 0; stripSize = 0;
    }
    pages.at(-1)!.cells.push({ part: entry.part, x: x + cursorX, y: y + cursorY,
      width: cellWidth, height: cellHeight, imageWidth, imageHeight, lines });
    if (asRows) { cursorX += cellWidth + gap; stripSize = Math.max(stripSize, cellHeight); }
    else { cursorY += cellHeight + gap; stripSize = Math.max(stripSize, cellWidth); }
  }
  return pages;
}

export async function drawStudioBom(
  pdf: jsPDF, document: BuilderDocument, page: StudioBomPage, locale: Locale,
  signal?: AbortSignal, renderPart = studioPartImage,
): Promise<void> {
  signal?.throwIfAborted();
  pdf.saveGraphicsState();
  try {
    if (page.background) {
      pdf.setFillColor(...page.background); pdf.rect(...page.rect, "F");
    }
    pdf.setFont("helvetica", page.fontStyle); pdf.setFontSize(page.fontSize);
    pdf.setTextColor(...page.color);
    if (!page.cells.length) {
      pdf.text(translate(locale, "instruction.pdf.bomEmpty"), page.rect[0] + 2, page.rect[1] + 6,
        { maxWidth: page.rect[2] - 4 });
    }
    for (const cell of page.cells) {
      signal?.throwIfAborted();
      const imageX = cell.x + (cell.width - cell.imageWidth) / 2;
      try {
        const data = await renderPart(document, cell.part, signal ?? new AbortController().signal,
          studioBomRasterSize(cell.imageWidth, cell.imageHeight));
        signal?.throwIfAborted();
        const image = pdf.getImageProperties(data);
        const ratio = Math.min(cell.imageWidth / image.width, cell.imageHeight / image.height);
        const width = image.width * ratio, height = image.height * ratio;
        pdf.addImage(data, data.startsWith("data:image/png") ? "PNG" : "JPEG",
          imageX + (cell.imageWidth - width) / 2, cell.y + (cell.imageHeight - height) / 2,
          width, height, undefined, "FAST");
      } catch {
        signal?.throwIfAborted();
        pdf.setFontSize(5);
        pdf.text(translate(locale, "instruction.pdf.previewUnavailable"), cell.x + 1, cell.y + 3, { maxWidth: cell.width - 2 });
        pdf.setFontSize(page.fontSize);
      }
      const lineHeight = page.fontSize * 25.4 / 72 * 1.15;
      pdf.text(cell.lines, cell.x + 1, cell.y + cell.imageHeight + lineHeight, { lineHeightFactor: 1.15 });
    }
  } finally { pdf.restoreGraphicsState(); }
}
