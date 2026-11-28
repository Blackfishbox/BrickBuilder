import type { jsPDF } from "jspdf";
import type { BuilderDocument } from "../editor/model";
import { translate, type Locale } from "../../i18n/messages";
import { yieldPdfExecution } from "../../platform/pdf-background";
import { instructionAxle } from "./axles";
import { normalizeSizeGuideReference, sizeGuideProjection } from "./size-guide-geometry";
import { sizeGuideReferences } from "./studio-size-guide";
import { studioVector } from "./studio-objects";
import type { StudioNode } from "./studio-layout";

export type AxleGuideCollection = Map<string, {
  reference: string; label: string; contexts: Set<string>;
}>;

/** A hidden or malformed native guide must not suppress automatic references. */
export function nativeAxleGuideReferences(nodes: StudioNode[]): Set<string> {
  return new Set(nodes.flatMap(node => {
    const rect = studioVector(node.attributes.rect ?? node.attributes.Rect, 4);
    return node.attributes.IsVisible?.toLowerCase() !== "false" && rect && rect[2] > 0 && rect[3] > 0
      ? sizeGuideReferences(node.attributes.Parts ?? "").map(normalizeSizeGuideReference) : [];
  }));
}

/** Occurrence-specific new parts only; one silhouette per distinct axle, all uses retained. */
export function collectAxleGuides(
  collection: AxleGuideCollection, document: BuilderDocument, ids: Iterable<string>, context: string,
  nativeReferences: ReadonlySet<string> = new Set(),
) {
  const selected = new Set(ids);
  const references = new Set((document.imported?.instances ?? [])
    .filter(part => selected.has(part.id)).map(part => normalizeSizeGuideReference(part.reference)));
  for (const reference of references) {
    if (nativeReferences.has(reference)) continue;
    const axle = instructionAxle(document, reference);
    if (!axle) continue;
    let guide = collection.get(reference);
    if (!guide) {
      guide = { reference, label: [axle.length, axle.name, axle.number].filter(Boolean).join(" · "), contexts: new Set() };
      collection.set(reference, guide);
    }
    guide.contexts.add(context);
  }
}

/** Append instead of reflowing Studio's fixed pages, arrows, callouts and inventory. */
export async function appendAxleGuidePages(
  pdf: jsPDF, document: BuilderDocument, guides: AxleGuideCollection, locale: Locale, signal?: AbortSignal,
  beforeNextPage: () => void = () => {},
) {
  if (!guides.size) return;
  const unit = 72 / 25.4 / pdf.internal.scaleFactor;
  const pageWidth = pdf.internal.pageSize.getWidth(), pageHeight = pdf.internal.pageSize.getHeight();
  const margin = Math.min(12 * unit, pageWidth / 10, pageHeight / 12);
  const width = pageWidth - 2 * margin, bottom = pageHeight - margin;
  const line = 3.5 * unit;
  let y = 0;
  const newPage = () => {
    signal?.throwIfAborted();
    beforeNextPage();
    pdf.addPage([pageWidth, pageHeight], pageWidth > pageHeight ? "landscape" : "portrait");
    pdf.setFont("helvetica", "bold"); pdf.setFontSize(12); pdf.setTextColor(0);
    pdf.text(translate(locale, "instruction.pdf.axleGuides"), margin, margin + 4 * unit, { maxWidth: width });
    pdf.setFont("helvetica", "normal"); pdf.setFontSize(7);
    const note = pdf.splitTextToSize(translate(locale, "instruction.pdf.actualSize"), width) as string[];
    y = margin + 10 * unit;
    pdf.text(note, margin, y);
    y += note.length * line + 4 * unit;
    const length = width >= 55 * unit ? 50 : 20;
    // A physical control measurement remains useful when the printer ignores PrintScaling.
    pdf.setDrawColor(0); pdf.setLineWidth(0.2 * unit);
    pdf.line(margin, y, margin + length * unit, y);
    for (let tick = 0; tick <= length; tick += 10) {
      pdf.line(margin + tick * unit, y - unit, margin + tick * unit, y + unit);
    }
    pdf.text(translate(locale, "instruction.pdf.controlLength", { length }), margin, y + 4 * unit);
    y += 10 * unit;
  };
  pdf.viewerPreferences({ PrintScaling: "None" });
  newPage();
  const bodyTop = y;
  for (const guide of guides.values()) {
    signal?.throwIfAborted();
    let projection: ReturnType<typeof sizeGuideProjection>;
    try { projection = sizeGuideProjection(document, guide.reference); }
    catch { projection = undefined; }
    const fits = !!projection && projection.width * unit <= width &&
      (projection.height + 18) * unit <= bottom - bodyTop;
    const label = `${guide.label} · ${fits ? "1:1" : translate(locale,
      projection ? "instruction.pdf.axleTooLarge" : "instruction.pdf.axleGeometryUnavailable")}`;
    pdf.setFontSize(8);
    const labels = pdf.splitTextToSize(label, width) as string[];
    const height = labels.length * line + (fits ? (projection!.height + 3) * unit : 0) + 4 * unit;
    if (y + height + line > bottom) newPage();
    pdf.setFont("helvetica", "bold"); pdf.setFontSize(8); pdf.setTextColor(0);
    pdf.text(labels, margin, y);
    y += labels.length * line;
    if (fits && projection) {
      pdf.setFillColor(0, 0, 0);
      for (const [ax, ay, bx, by, cx, cy] of projection.triangles) {
        pdf.triangle(margin + ax * unit, y + ay * unit, margin + bx * unit, y + by * unit,
          margin + cx * unit, y + cy * unit, "F");
      }
      y += (projection.height + 3) * unit;
    }
    pdf.setFont("helvetica", "normal"); pdf.setFontSize(7);
    const contexts = pdf.splitTextToSize([...guide.contexts].join("; "), width) as string[];
    for (const context of contexts) {
      if (y + line > bottom) {
        newPage();
        pdf.text(`${guide.label} (${translate(locale, "instruction.pdf.continued")})`, margin, y, { maxWidth: width });
        y += 2 * line;
      }
      pdf.text(context, margin, y);
      y += line;
    }
    y += 5 * unit;
    await yieldPdfExecution();
    signal?.throwIfAborted();
  }
}
