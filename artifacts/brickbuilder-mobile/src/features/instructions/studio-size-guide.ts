import type { jsPDF } from "jspdf";
import type { BuilderDocument } from "../editor/model";
import { studioVector, type StudioRect } from "./studio-objects";
import type { StudioNode } from "./studio-layout";
import { normalizeSizeGuideReference as normalize, sizeGuidePart, sizeGuideProjection } from "./size-guide-geometry";
import type { Locale } from "../../i18n/messages";

// The native XML reader preserves numeric attribute entities. Studio uses these
// as row delimiters; literal newlines also occur in edited layouts.
const sizeGuideReferences = (parts: string) =>
  parts.replace(/&#(?:10|13|x0*[ad]);/gi, "\n").trim().split(/[\r\n]+/)
    .map(line => line.trim().split(/\s+/)[0]).filter(Boolean);

/** Nominal lengths remain labels only; stops and end clearances come from geometry. */
export function studioSizeGuideLabels(document: BuilderDocument, parts: string): string[] {
  return sizeGuideReferences(parts).map(reference => {
    const number = normalize(reference);
    const part = sizeGuidePart(document, reference);
    const name = part?.part.name;
    const namedLength = name?.match(/\baxle\s+(\d+(?:\.\d+)?)/i)?.[1];
    if (namedLength) return `${namedLength}L · ${name} · ${number}`;
    if (name) return `${name} · ${number}`;
    // Missing names must not turn a stop's overall extent into a guessed length.
    try {
      const projection = sizeGuideProjection(document, reference);
      if (projection) return `${Number(projection.width.toFixed(3))} mm · ${number}`;
    } catch { /* Keep the identifier; the drawing reports unavailable geometry. */ }
    return number;
  });
}

export function drawStudioSizeGuide(
  pdf: jsPDF, document: BuilderDocument, node: StudioNode, content: StudioRect,
  locale: Locale = "de",
) {
  if (node.attributes.IsVisible?.toLowerCase() === "false") return;
  const rect = studioVector(node.attributes.rect ?? node.attributes.Rect, 4);
  const labels = studioSizeGuideLabels(document, node.attributes.Parts ?? "");
  if (!rect || rect[2] <= 0 || rect[3] <= 0 || !labels.length) return;
  const english = locale === "en";
  const missing = english ? "No measuring image: geometry unavailable" : "Keine Messabbildung: Geometrie fehlt oder ist nicht nutzbar";
  const tooWide = english ? "No measuring image: not enough space" : "Keine Messabbildung: zu wenig Platz";
  // PDF coordinates can use a unit other than mm. Studio box dimensions are mm.
  const unit = 72 / 25.4 / pdf.internal.scaleFactor;
  const references = sizeGuideReferences(node.attributes.Parts ?? "");
  const projections = references.map(reference => {
    try { return sizeGuideProjection(document, reference); }
    catch { return undefined; } // Never replace failed source geometry with a thumbnail.
  });
  const width = Math.min(Math.max(rect[2] * unit,
    ...projections.map(projection => (projection ? projection.width + 4 : 0) * unit)), content[2]);
  if (width < 12 * unit) throw new Error(tooWide);
  pdf.saveGraphicsState();
  pdf.setFont("helvetica", "normal"); pdf.setFontSize(7); pdf.setTextColor(0);
  const lineHeight = 3.2 * unit, padding = 2 * unit;
  const rows = labels.map((label, index) => {
    const projection = projections[index];
    const fits = projection && projection.width * unit <= width - padding * 2;
    const lines = pdf.splitTextToSize(`${label} · ${fits ? "1:1" : projection ? tooWide : missing}`, width - padding * 2) as string[];
    return { lines, projection: fits ? projection : undefined,
      height: lines.length * lineHeight + (fits ? projection.height * unit + padding : 0) + padding };
  });
  const hasImage = rows.some(row => row.projection);
  if (hasImage) pdf.viewerPreferences({ PrintScaling: "None" });
  const note = english ? "Print at 100% / Actual size. Do not fit to page."
    : "Mit 100% / Tatsächliche Größe drucken. Keine Seitenanpassung.";
  const noteLines = hasImage ? pdf.splitTextToSize(note, width - padding * 2) as string[] : [];
  const height = Math.max(rect[3] * unit, padding + rows.reduce((sum, row) => sum + row.height, 0)
    + noteLines.length * lineHeight);
  if (height > content[3]) {
    pdf.restoreGraphicsState();
    throw new Error(tooWide);
  }
  // Anchors are printable-page relative even when nested in a Slot.
  const x = Math.max(content[0], Math.min(content[0] + content[2] - width, content[0] + rect[0] * content[2]));
  const y = Math.max(content[1], Math.min(content[1] + content[3] - height,
    content[1] + (1 - rect[1]) * content[3] - height));
  pdf.setFillColor(255, 255, 255); pdf.setDrawColor(0); pdf.setLineWidth(0.35);
  pdf.rect(x, y, width, height, "FD");
  let rowY = y + padding;
  for (const row of rows) {
    row.lines.forEach((line, index) => pdf.text(line, x + padding, rowY + (index + 0.8) * lineHeight));
    if (row.projection) {
      const top = rowY + row.lines.length * lineHeight + unit;
      pdf.setFillColor(0, 0, 0);
      // Filled source triangles form an orthographic silhouette, including stops,
      // without mesh diagonals, perspective, end trimming or automatic fitting.
      for (const [ax, ay, bx, by, cx, cy] of row.projection.triangles) {
        pdf.triangle(x + padding + ax * unit, top + ay * unit,
          x + padding + bx * unit, top + by * unit, x + padding + cx * unit, top + cy * unit, "F");
      }
    }
    rowY += row.height;
  }
  noteLines.forEach((line, index) => pdf.text(line, x + padding, rowY + (index + 0.8) * lineHeight));
  pdf.restoreGraphicsState();
}
