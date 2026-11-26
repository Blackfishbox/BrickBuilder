import type { jsPDF } from "jspdf";
import { Box3, Vector3 } from "three";
import type { BuilderDocument } from "../editor/model";
import { compilePart } from "../engine/ldraw-geometry";
import { studioVector, type StudioRect } from "./studio-objects";
import type { StudioNode } from "./studio-layout";

const normalize = (reference: string) => reference.replaceAll("\\", "/").split("/").pop()!.toLowerCase().replace(/\.dat$/, "");

/** Retain an unambiguous length/name even without Studio's 1:1 guide renderer. */
export function studioSizeGuideLabels(document: BuilderDocument, parts: string): string[] {
  return parts.trim().split(/[\r\n]+/).flatMap(line => {
    const reference = line.trim().split(/\s+/)[0];
    if (!reference) return [];
    const number = normalize(reference);
    const part = document.imported?.instances.find(part => normalize(part.reference) === number);
    const name = part?.part.name;
    const namedLength = name?.match(/\baxle\s+(\d+(?:\.\d+)?)/i)?.[1];
    if (namedLength) return [`${namedLength}L · ${name} · ${number}`];
    if (name) return [`${name} · ${number}`];
    // A source size guide explicitly selects a length-sensitive part. With
    // missing catalog names, use its actual longest local dimension in studs.
    if (document.imported && part?.part.status === "resolved") {
      const bounds = new Box3(), point = new Vector3();
      for (const surface of compilePart(document.imported, part.reference, "16")) {
        for (let offset = 0; offset < surface.positions.length; offset += 3) {
          bounds.expandByPoint(point.fromArray(surface.positions, offset));
        }
      }
      if (!bounds.isEmpty()) {
        const size = bounds.getSize(point);
        const length = Math.round(Math.max(size.x, size.y, size.z) / 20 * 2) / 2;
        if (length > 0) return [`${length}L · ${number}`];
      }
    }
    return [number];
  });
}

export function drawStudioSizeGuide(
  pdf: jsPDF, document: BuilderDocument, node: StudioNode, content: StudioRect,
) {
  if (node.attributes.IsVisible?.toLowerCase() === "false") return;
  const rect = studioVector(node.attributes.rect ?? node.attributes.Rect, 4);
  const labels = studioSizeGuideLabels(document, node.attributes.Parts ?? "");
  if (!rect || rect[2] <= 0 || rect[3] <= 0 || !labels.length) return;
  // Size-guide anchors are relative to the printable page, even under a Slot;
  // box dimensions remain millimeters. Do not label a fitted thumbnail "1:1".
  const width = Math.min(rect[2], content[2]), height = Math.min(Math.max(rect[3], labels.length * 5), content[3]);
  const x = Math.max(content[0], Math.min(content[0] + content[2] - width, content[0] + rect[0] * content[2]));
  const y = Math.max(content[1], Math.min(content[1] + content[3] - height,
    content[1] + (1 - rect[1]) * content[3] - height));
  pdf.saveGraphicsState();
  pdf.setFillColor(255, 255, 255); pdf.setDrawColor(0); pdf.setLineWidth(0.35);
  pdf.rect(x, y, width, height, "FD");
  pdf.setFont("helvetica", "normal"); pdf.setTextColor(0); pdf.setFontSize(12);
  const lines = labels.flatMap(label => pdf.splitTextToSize(label, width - 4) as string[]);
  const fontSize = Math.min(12, (height - 3) / Math.max(1, lines.length) * 72 / 25.4 / 1.15);
  pdf.setFontSize(Math.max(5, fontSize));
  pdf.text(lines, x + 2, y + 2 + Math.max(5, fontSize) * 25.4 / 72, { maxWidth: width - 4 });
  pdf.restoreGraphicsState();
}
