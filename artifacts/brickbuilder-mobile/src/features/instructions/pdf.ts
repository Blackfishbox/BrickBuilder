import { jsPDF } from "jspdf";
import { collectByteSource } from "../../types/byte-source";
import { instructionPdfChunks } from "./pdf-output";
import { yieldPdfExecution } from "../../platform/pdf-background";
import type { BuilderDocument } from "../editor/model";
import { effectiveInstructions } from "./model";
import type { InstructionPlan } from "./types";
import { renderInstructionImage, type InstructionImageRenderer } from "./render";
import { createExportInstructionRenderer } from "./export-renderer";
import { instructionColorLabel, instructionPartGroups, instructionStepNumber } from "./parts";
import { instructionPartImage } from "./part-images";
import { drawInstructionPartBox } from "./pdf-parts";
import { exportInstructionCalloutImage, instructionHighlightIds } from "./callouts";
import { translate, translatePlural, type Locale } from "../../i18n/messages";
import { appendAxleGuidePages, collectAxleGuides, type AxleGuideCollection } from "./axle-guides";

export interface InstructionPdfOptions {
  signal?: AbortSignal;
  onProgress?: (done: number, total: number) => void;
  highlight?: boolean;
  locale?: Locale;
}

export function instructionParts(document: BuilderDocument, ids: string[]): string[] {
  return instructionPartGroups(document, ids).map(entry => `${entry.count} × ${entry.number} · ${instructionColorLabel(entry.colorName)}`);
}

export async function exportInstructionPDF(...args: Parameters<typeof exportInstructionPdfChunks>): Promise<Uint8Array> {
  return collectByteSource(await exportInstructionPdfChunks(...args));
}

export async function exportInstructionPdfChunks(
  document: BuilderDocument,
  input: InstructionPlan,
  options: InstructionPdfOptions = {},
  createRenderer: (document: BuilderDocument, signal?: AbortSignal) => Promise<InstructionImageRenderer> = createExportInstructionRenderer,
  renderPart = instructionPartImage,
  renderCallout?: typeof import("./callouts").instructionCalloutImage,
): Promise<AsyncIterable<Uint8Array>> {
  const plan = effectiveInstructions({ ...document, instructions: input });
  const locale = options.locale ?? "de";
  options.signal?.throwIfAborted();
  options.onProgress?.(0, plan.steps.length);
  const renderer = await createRenderer(document, options.signal);
  const calloutImage = renderCallout ?? ((doc, callout, signal) => exportInstructionCalloutImage(doc, callout, renderer, signal));
  try {
    const pdf = new jsPDF({ unit: "mm", format: "a4", compress: true });
    pdf.setProperties({
      title: `${document.name} – ${translate(locale, "instruction.pdf.title")}`,
      creator: "BrickBuilder",
    });
    const visible = new Set<string>();
    const axleGuides: AxleGuideCollection = new Map();
    for (const [index, step] of plan.steps.entries()) {
      options.signal?.throwIfAborted();
      if (index) pdf.addPage();
      collectAxleGuides(axleGuides, document, instructionHighlightIds(document, step),
        translate(locale, "instruction.pdf.axlePageStep", { page: pdf.getNumberOfPages(), step: index + 1 }));
      pdf.setFont("helvetica", "bold"); pdf.setFontSize(17);
      pdf.text(instructionStepNumber(index + 1), 16, 20);
      let imageY = 24;
      const groups = instructionPartGroups(document, step.partIds);
      const callouts = step.callouts ?? [];
      const firstPageParts = callouts.length ? 6 : 12;
      if (groups.length || callouts.length) {
        imageY += await drawInstructionPartBox(
          pdf, document, groups.slice(0, firstPageParts), imageY, options.signal, renderPart,
          callouts.slice(0, 3), calloutImage, locale,
        ) + 4;
      }
      step.partIds.forEach(id => visible.add(id));
      const highlightIds = options.highlight && index > 0 ? instructionHighlightIds(document, step) : undefined;
      const image = await renderInstructionImage(renderer, visible, step, highlightIds);
      pdf.addImage(image, image.startsWith("data:image/png") ? "PNG" : "JPEG", 15, imageY, 180, 136.8, undefined, "FAST");
      let y = imageY + 145;
      const continuationPage = (section: string) => {
        pdf.addPage();
        pdf.setFont("helvetica", "bold"); pdf.setFontSize(13);
        const continued = translate(locale, "instruction.pdf.continued");
        const heading = pdf.splitTextToSize(`${instructionStepNumber(index + 1)} ${section} (${continued})`, 178) as string[];
        pdf.text(heading, 16, 20);
        return 24 + (heading.length - 1) * 6;
      };
      const text = (value: string, bold = false) => {
        pdf.setFont("helvetica", bold ? "bold" : "normal"); pdf.setFontSize(10);
        const lines = pdf.splitTextToSize(value, 178) as string[];
        for (const line of lines) {
          if (y > 277) y = continuationPage(translate(locale, "instruction.pdf.notes"));
          pdf.text(line, 16, y); y += 5;
        }
      };
      const partCount = step.partIds.length;
      const newParts = partCount ? translatePlural(locale, "instruction.pdf.newParts", partCount) : "";
      const calloutSummary = callouts.length
        ? ` · ${translatePlural(locale, "instruction.pdf.assemblies", callouts.length)}`
        : "";
      const cumulative = translatePlural(locale, "instruction.pdf.cumulativeParts", visible.size);
      text(`${newParts}${calloutSummary}${newParts || calloutSummary ? " · " : ""}${cumulative}`, true);
      if (step.notes) { y += 3; text(step.notes); }
      const missing = document.imported?.instances.filter(part => visible.has(part.id) && part.part.status !== "resolved") ?? [];
      if (missing.length) {
        y += 3;
        pdf.setTextColor(155, 45, 20);
        text(translate(locale, "instruction.pdf.missingGeometry", { count: missing.length }));
        pdf.setTextColor(0);
      }
      for (let offset = 3; offset < callouts.length; offset += 12) {
        const y = continuationPage(translate(locale, "instruction.pdf.subassemblies"));
        await drawInstructionPartBox(pdf, document, [], y, options.signal, renderPart,
          callouts.slice(offset, offset + 12), calloutImage, locale);
      }
      for (let offset = firstPageParts; offset < groups.length; offset += 36) {
        y = continuationPage(translate(locale, "instruction.pdf.parts"));
        y += await drawInstructionPartBox(pdf, document, groups.slice(offset, offset + 36), y, options.signal,
          renderPart, [], calloutImage, locale) + 4;
      }
      options.onProgress?.(index + 1, plan.steps.length);
      // Give Android a chance to repaint progress and deliver cancellation.
      await yieldPdfExecution();
    }
    await appendAxleGuidePages(pdf, document, axleGuides, locale, options.signal);
    const count = pdf.getNumberOfPages();
    for (let page = 1; page <= count; page++) {
      pdf.setPage(page); pdf.setFontSize(8); pdf.setTextColor(95);
      pdf.text(`BrickBuilder · ${document.name}`, 16, 290, { maxWidth: 150 });
      pdf.text(`${page} / ${count}`, 194, 290, { align: "right" });
    }
    return instructionPdfChunks(pdf, options.signal);
  } finally { renderer.dispose(); }
}
