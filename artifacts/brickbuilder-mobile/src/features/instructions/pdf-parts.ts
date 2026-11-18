import type { jsPDF } from "jspdf";
import type { BuilderDocument } from "../editor/model";
import type { InstructionPart } from "./parts";
import { instructionPartImage } from "./part-images";

/** Six columns, bounded rows per page; every entry is emitted by the caller. */
export async function drawInstructionPartBox(
  pdf: jsPDF, document: BuilderDocument, entries: InstructionPart[], y: number,
  signal?: AbortSignal, renderImage = instructionPartImage,
): Promise<number> {
  const height = 8 + Math.max(1, Math.ceil(entries.length / 6)) * 33;
  pdf.setDrawColor(183, 194, 181); pdf.setFillColor(253, 253, 249);
  pdf.roundedRect(15, y, 180, height, 2, 2, "FD");
  pdf.setTextColor(35, 55, 46); pdf.setFont("helvetica", "bold"); pdf.setFontSize(9);
  pdf.text("Teile in diesem Schritt", 19, y + 5);
  if (!entries.length) {
    pdf.setFont("helvetica", "normal"); pdf.text("Keine neuen Teile", 19, y + 15);
  }
  for (const [index, entry] of entries.entries()) {
    signal?.throwIfAborted();
    const x = 15 + index % 6 * 30, top = y + 8 + Math.floor(index / 6) * 33;
    try {
      const image = await renderImage(document, entry, signal ?? new AbortController().signal);
      signal?.throwIfAborted();
      pdf.addImage(image, image.startsWith("data:image/png") ? "PNG" : "JPEG", x + 4, top + 1, 22, 16.7, undefined, "FAST");
    } catch {
      signal?.throwIfAborted();
      pdf.setFont("helvetica", "normal"); pdf.setFontSize(6.5); pdf.setTextColor(142, 61, 40);
      pdf.text("Vorschau fehlt", x + 15, top + 11, { align: "center" });
    }
    pdf.setTextColor(35, 55, 46); pdf.setFont("helvetica", "bold"); pdf.setFontSize(9);
    pdf.text(`${entry.count}×`, x + 27, top + 4, { align: "right" });
    pdf.setFontSize(7);
    const number = (pdf.splitTextToSize(entry.number, 26) as string[]).slice(0, 2);
    pdf.text(number, x + 15, top + 21, { align: "center" });
    pdf.setFont("helvetica", "normal"); pdf.setFontSize(6.5);
    const color = (pdf.splitTextToSize(entry.colorName, 26) as string[]).slice(0, 2);
    pdf.text(color, x + 15, top + 28, { align: "center" });
  }
  pdf.setTextColor(0);
  return height;
}
