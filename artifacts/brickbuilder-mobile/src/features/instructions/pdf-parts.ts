import type { jsPDF } from "jspdf";
import type { BuilderDocument } from "../editor/model";
import type { InstructionPart } from "./parts";
import { instructionPartImage } from "./part-images";
import { instructionCalloutImage } from "./callouts";
import type { InstructionCallout } from "./types";
import { translate, type Locale } from "../../i18n/messages";

/** Six columns, bounded rows per page; every entry is emitted by the caller. */
export async function drawInstructionPartBox(
  pdf: jsPDF, document: BuilderDocument, entries: InstructionPart[], y: number,
  signal?: AbortSignal, renderImage = instructionPartImage,
  callouts: InstructionCallout[] = [], renderCallout = instructionCalloutImage,
  locale: Locale = "de",
): Promise<number> {
  const calloutRows = Math.ceil(callouts.length / 3);
  pdf.setFont("helvetica", "bold"); pdf.setFontSize(7);
  const calloutTitles = callouts.map(callout => pdf.splitTextToSize(callout.title, 56) as string[]);
  const calloutLineHeight = 7 * 1.15 * 25.4 / 72;
  const calloutRowHeights = Array.from({ length: calloutRows }, (_, row) => {
    const rows = calloutTitles.slice(row * 3, row * 3 + 3);
    const maxLines = Math.max(1, ...rows.map(title => title.length));
    return Math.max(39, 35 + calloutLineHeight * (maxLines - 1));
  });
  const calloutHeight = calloutRowHeights.reduce((total, rowHeight) => total + rowHeight, 0);
  const partRows = Math.max(1, Math.ceil(entries.length / 6));
  const height = 8 + calloutHeight + partRows * 33;
  pdf.setDrawColor(183, 194, 181); pdf.setFillColor(253, 253, 249);
  pdf.roundedRect(15, y, 180, height, 2, 2, "FD");
  pdf.setTextColor(35, 55, 46); pdf.setFont("helvetica", "bold"); pdf.setFontSize(9);
  pdf.text(translate(locale, callouts.length
    ? "instruction.pdf.partsAndAssembliesInStep"
    : "instruction.pdf.partsInStep"), 19, y + 5);
  if (!entries.length && !callouts.length) {
    pdf.setFont("helvetica", "normal");
    pdf.text(translate(locale, "instruction.pdf.noNewParts"), 19, y + 15);
  }
  if (callouts.length) {
    pdf.setFontSize(7);
    pdf.text(translate(locale, "instruction.pdf.insertSubassemblies"), 19, y + 11);
    for (const [index, callout] of callouts.entries()) {
      signal?.throwIfAborted();
      const row = Math.floor(index / 3);
      const x = 15 + index % 3 * 60;
      const top = y + 13 + calloutRowHeights.slice(0, row).reduce((total, rowHeight) => total + rowHeight, 0);
      try {
        const image = await renderCallout(document, callout, signal ?? new AbortController().signal);
        signal?.throwIfAborted();
        pdf.addImage(image, image.startsWith("data:image/png") ? "PNG" : "JPEG", x + 3, top + 1, 54, 27, undefined, "FAST");
      } catch {
        signal?.throwIfAborted();
        pdf.setFont("helvetica", "normal"); pdf.setFontSize(6.5); pdf.setTextColor(142, 61, 40);
        pdf.text(translate(locale, "instruction.pdf.previewUnavailable"), x + 30, top + 14, { align: "center" });
      }
      pdf.setTextColor(35, 55, 46); pdf.setFont("helvetica", "bold"); pdf.setFontSize(7);
      const title = calloutTitles[index];
      const baseline = calloutRowHeights[row] - 5 - calloutLineHeight * (title.length - 1);
      pdf.text(title, x + 30, top + baseline, { align: "center" });
    }
  }
  for (const [index, entry] of entries.entries()) {
    signal?.throwIfAborted();
    const x = 15 + index % 6 * 30, top = y + 8 + calloutHeight + Math.floor(index / 6) * 33;
    try {
      const image = await renderImage(document, entry, signal ?? new AbortController().signal);
      signal?.throwIfAborted();
      pdf.addImage(image, image.startsWith("data:image/png") ? "PNG" : "JPEG", x + 4, top + 1, 22, 16.7, undefined, "FAST");
    } catch {
      signal?.throwIfAborted();
      pdf.setFont("helvetica", "normal"); pdf.setFontSize(6.5); pdf.setTextColor(142, 61, 40);
      pdf.text(translate(locale, "instruction.pdf.previewUnavailable"), x + 15, top + 11, { align: "center" });
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
