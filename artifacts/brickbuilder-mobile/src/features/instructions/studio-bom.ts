import type { jsPDF } from "jspdf";
import { Box3, Vector3 } from "three";
import type { BuilderDocument } from "../editor/model";
import { compilePart } from "../engine/ldraw-geometry";
import { translate, type Locale } from "../../i18n/messages";
import { instructionColorLabel, instructionPartGroups, type InstructionPart } from "./parts";
import { instructionPartImage } from "./part-images";
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
  if (part.kind === "imported" && document.imported && part.part.part.status === "resolved") {
    try {
      const bounds = new Box3();
      const vertex = new Vector3();
      for (const surface of compilePart(document.imported, part.part.reference, "16")) {
        for (let offset = 0; offset < surface.positions.length; offset += 3) {
          bounds.expandByPoint(vertex.fromArray(surface.positions, offset));
        }
      }
      if (!bounds.isEmpty()) {
        const size = bounds.getSize(new Vector3());
        // Canonical isometric footprint in millimetres (one LDU = 0.4 mm).
        return [Math.max(9, (size.x + size.z) * Math.SQRT1_2 * 0.4 * scale),
          Math.max(9, (size.y * 0.82 + (size.x + size.z) * 0.41) * 0.4 * scale)];
      }
    } catch { /* The cell retains its labels and an explicit unavailable-preview message. */ }
  }
  return [20 * scale, 16 * scale];
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
  const largeScale = partSize.EnableLargeBrickScale?.toLowerCase() === "true"
    ? positive(partSize.LargeBrickScale, 0.5, 0.1, 1) : 1;
  const collator = new Intl.Collator(locale, { numeric: true, sensitivity: "base" });
  const entries = studioBomParts(document).map(part => {
    signal?.throwIfAborted();
    let [imageWidth, imageHeight] = imageDimensions(document, part, imageScale);
    if (Math.max(imageWidth, imageHeight) > 48) { imageWidth *= largeScale; imageHeight *= largeScale; }
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
  for (const entry of entries) {
    signal?.throwIfAborted();
    // Leave enough label room and shrink oversized images, never the quantities.
    const cellWidth = Math.min(width, Math.max(22, Math.min(entry.imageWidth + 2, width)));
    const number = entry.part.number.replace(/^LDraw\s+/, "");
    const lines = [
      ...pdf.splitTextToSize(`${new Intl.NumberFormat(locale).format(entry.part.count)}x`, cellWidth - 2) as string[],
      ...pdf.splitTextToSize(number, cellWidth - 2) as string[],
      ...pdf.splitTextToSize(instructionColorLabel(entry.part.colorName), cellWidth - 2) as string[],
    ];
    const labelHeight = lines.length * lineHeight + 2;
    if (labelHeight + 4 > height) throw new Error(translate(locale, "instruction.pdf.bomTooSmall"));
    const fit = Math.min(1, (cellWidth - 2) / entry.imageWidth, (height - labelHeight) / entry.imageHeight);
    const imageWidth = entry.imageWidth * fit, imageHeight = entry.imageHeight * fit;
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
  signal?: AbortSignal, renderPart = instructionPartImage,
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
        const data = await renderPart(document, cell.part, signal ?? new AbortController().signal);
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
