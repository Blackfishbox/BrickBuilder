import { jsPDF } from "jspdf";
import type { BuilderDocument } from "../editor/model";
import { effectiveInstructions } from "./model";
import type { InstructionPlan } from "./types";
import { createInstructionRenderer, type InstructionImageRenderer } from "./render";
import { instructionPartGroups } from "./parts";
import { instructionPartImage } from "./part-images";
import { drawInstructionPartBox } from "./pdf-parts";
import { instructionCalloutImage, instructionHighlightIds } from "./callouts";

export interface InstructionPdfOptions {
  signal?: AbortSignal;
  onProgress?: (done: number, total: number) => void;
  highlight?: boolean;
}

export function instructionParts(document: BuilderDocument, ids: string[]): string[] {
  return instructionPartGroups(document, ids).map(entry => `${entry.count} × ${entry.number} · ${entry.colorName}`);
}

export async function exportInstructionPDF(
  document: BuilderDocument,
  input: InstructionPlan,
  options: InstructionPdfOptions = {},
  createRenderer: (document: BuilderDocument, signal?: AbortSignal) => Promise<InstructionImageRenderer> = createInstructionRenderer,
  renderPart = instructionPartImage,
  renderCallout = instructionCalloutImage,
): Promise<Uint8Array> {
  const plan = effectiveInstructions({ ...document, instructions: input });
  options.signal?.throwIfAborted();
  options.onProgress?.(0, plan.steps.length);
  const renderer = await createRenderer(document, options.signal);
  try {
    const pdf = new jsPDF({ unit: "mm", format: "a4", compress: true });
    pdf.setProperties({ title: `${document.name} – Bauanleitung`, creator: "BrickBuilder Mobile" });
    const visible = new Set<string>();
    for (const [index, step] of plan.steps.entries()) {
      options.signal?.throwIfAborted();
      if (index) pdf.addPage();
      pdf.setFont("helvetica", "bold"); pdf.setFontSize(17);
      const title = pdf.splitTextToSize(`${index + 1}. ${step.title}`, 178) as string[];
      pdf.text(title, 16, 20);
      let imageY = 24 + (title.length - 1) * 7;
      const groups = instructionPartGroups(document, step.partIds);
      const callouts = step.callouts ?? [];
      const firstPageParts = callouts.length ? 6 : 12;
      imageY += await drawInstructionPartBox(
        pdf, document, groups.slice(0, firstPageParts), imageY, options.signal, renderPart,
        callouts.slice(0, 3), renderCallout,
      ) + 4;
      step.partIds.forEach(id => visible.add(id));
      const highlightIds = options.highlight && index > 0 ? instructionHighlightIds(document, step) : undefined;
      pdf.addImage(renderer.image(visible, step, highlightIds), "JPEG", 15, imageY, 180, 136.8, undefined, "FAST");
      let y = imageY + 145;
      const text = (value: string, bold = false) => {
        pdf.setFont("helvetica", bold ? "bold" : "normal"); pdf.setFontSize(10);
        const lines = pdf.splitTextToSize(value, 178) as string[];
        for (const line of lines) {
          if (y > 277) { pdf.addPage(); y = 20; }
          pdf.text(line, 16, y); y += 5;
        }
      };
      const calloutSummary = callouts.length ? ` · ${callouts.length} Baugruppen einsetzen` : "";
      text(`${step.partIds.length} neue Teile${calloutSummary} · ${visible.size} Teile bis zu diesem Schritt`, true);
      if (step.notes) { y += 3; text(step.notes); }
      const missing = document.imported?.instances.filter(part => visible.has(part.id) && part.part.status !== "resolved") ?? [];
      if (missing.length) {
        y += 3;
        pdf.setTextColor(155, 45, 20);
        text(`Hinweis: ${missing.length} Teile ohne geladene Geometrie sind in der Abbildung nicht dargestellt. Die Teileliste bleibt vollständig.`);
        pdf.setTextColor(0);
      }
      for (let offset = 3; offset < callouts.length; offset += 12) {
        pdf.addPage();
        pdf.setFont("helvetica", "bold"); pdf.setFontSize(13);
        const continued = pdf.splitTextToSize(`${index + 1}. ${step.title} – Baugruppen (Fortsetzung)`, 178) as string[];
        pdf.text(continued, 16, 20);
        const y = 24 + (continued.length - 1) * 6;
        await drawInstructionPartBox(pdf, document, [], y, options.signal, renderPart,
          callouts.slice(offset, offset + 12), renderCallout);
      }
      for (let offset = firstPageParts; offset < groups.length; offset += 36) {
        if (offset === firstPageParts) text("Weitere Teile für diesen Schritt auf den folgenden Seiten.");
        pdf.addPage();
        pdf.setFont("helvetica", "bold"); pdf.setFontSize(13);
        const continued = pdf.splitTextToSize(`${index + 1}. ${step.title} – Teile (Fortsetzung)`, 178) as string[];
        pdf.text(continued, 16, 20);
        y = 24 + (continued.length - 1) * 6;
        y += await drawInstructionPartBox(pdf, document, groups.slice(offset, offset + 36), y, options.signal, renderPart) + 4;
      }
      options.onProgress?.(index + 1, plan.steps.length);
      // Give Android a chance to repaint progress and deliver cancellation.
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    const count = pdf.getNumberOfPages();
    for (let page = 1; page <= count; page++) {
      pdf.setPage(page); pdf.setFontSize(8); pdf.setTextColor(95);
      pdf.text(`BrickBuilder Mobile · ${document.name}`, 16, 290, { maxWidth: 150 });
      pdf.text(`${page} / ${count}`, 194, 290, { align: "right" });
    }
    return new Uint8Array(pdf.output("arraybuffer"));
  } finally { renderer.dispose(); }
}
