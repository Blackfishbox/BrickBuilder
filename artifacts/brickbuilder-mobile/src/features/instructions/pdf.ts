import { jsPDF } from "jspdf";
import { BRICK_DEFINITIONS, type BuilderDocument } from "../editor/model";
import { resolveColor } from "../formats/colors";
import { effectiveInstructions } from "./model";
import type { InstructionPlan } from "./types";
import { createInstructionRenderer, type InstructionImageRenderer } from "./render";

export interface InstructionPdfOptions {
  signal?: AbortSignal;
  onProgress?: (done: number, total: number) => void;
}

export function instructionParts(document: BuilderDocument, ids: string[]): string[] {
  const selected = new Set(ids), rows = new Map<string, number>();
  for (const part of document.imported?.instances ?? []) {
    if (!selected.has(part.id)) continue;
    const color = part.color?.name ?? resolveColor(part.colorCode)?.name ?? `LDraw ${part.colorCode}`;
    const label = `${part.part.brickLinkId ?? `LDraw ${part.part.ldrawId}`} · ${color}`;
    rows.set(label, (rows.get(label) ?? 0) + 1);
  }
  for (const part of document.bricks) {
    if (!selected.has(part.id)) continue;
    const label = `LDraw ${BRICK_DEFINITIONS[part.type].ldrawId} · ${part.color}`;
    rows.set(label, (rows.get(label) ?? 0) + 1);
  }
  return [...rows.entries()].map(([label, count]) => `${count} × ${label}`);
}

export async function exportInstructionPDF(
  document: BuilderDocument,
  input: InstructionPlan,
  options: InstructionPdfOptions = {},
  createRenderer: (document: BuilderDocument, signal?: AbortSignal) => Promise<InstructionImageRenderer> = createInstructionRenderer,
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
      const imageY = 24 + (title.length - 1) * 7;
      step.partIds.forEach(id => visible.add(id));
      pdf.addImage(renderer.image(visible, step), "JPEG", 15, imageY, 180, 136.8, undefined, "FAST");
      let y = imageY + 145;
      const text = (value: string, bold = false) => {
        pdf.setFont("helvetica", bold ? "bold" : "normal"); pdf.setFontSize(10);
        const lines = pdf.splitTextToSize(value, 178) as string[];
        for (const line of lines) {
          if (y > 277) { pdf.addPage(); y = 20; }
          pdf.text(line, 16, y); y += 5;
        }
      };
      text(`${step.partIds.length} neue Teile · ${visible.size} Teile bis zu diesem Schritt`, true);
      if (step.notes) { y += 3; text(step.notes); }
      const missing = document.imported?.instances.filter(part => visible.has(part.id) && part.part.status !== "resolved") ?? [];
      if (missing.length) {
        y += 3;
        pdf.setTextColor(155, 45, 20);
        text(`Hinweis: ${missing.length} Teile ohne geladene Geometrie sind in der Abbildung nicht dargestellt. Die Teileliste bleibt vollständig.`);
        pdf.setTextColor(0);
      }
      y += 4; text("Teile in diesem Schritt", true);
      for (const row of instructionParts(document, step.partIds)) text(row);
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
