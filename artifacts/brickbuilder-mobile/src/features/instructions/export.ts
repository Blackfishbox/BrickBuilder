import type { BuilderDocument } from "../editor/model";
import { exportLDR } from "../formats/ldraw/export";
import { effectiveInstructions } from "./model";

/**
 * Edited instruction order is instance-specific. Export a flat construction root
 * rather than moving shared submodel definitions and changing every occurrence.
 * Keep every original section as an unreferenced source record.
 */
export function exportInstructionMPD(document: BuilderDocument): Uint8Array {
  const plan = effectiveInstructions(document);
  const originalSections = document.imported?.sections ?? {};
  if (Object.values(originalSections).some(lines => lines.some(line => /^\s*[2-5]\s/.test(line)))) {
    throw new Error("Geänderte Anleitung: Diese Datei enthält eingebettete Flächengeometrie. Ein sicherer MPD-/IO-Export der geänderten Schrittfolge wird dafür noch nicht unterstützt. Bitte als JSON-Projekt sichern; das Originalarchiv bleibt erhalten.");
  }
  let root = "brickbuilder-instructions.ldr";
  while (Object.hasOwn(originalSections, root)) root = `_${root}`;
  const lines = [`0 FILE ${root}`, "0 BrickBuilder construction steps; flattened assembly"];
  const imported = new Map(document.imported?.instances.map(part => [part.id, part]) ?? []);
  const bricks = new Map(document.bricks.map(part => [part.id, part]));
  for (const step of plan.steps) {
    lines.push(`0 !BRICKBUILDER TITLE ${JSON.stringify(step.title)}`, `0 !BRICKBUILDER NOTE ${JSON.stringify(step.notes)}`);
    const view: BuilderDocument = {
      ...document, bricks: step.partIds.flatMap(id => bricks.has(id) ? [bricks.get(id)!] : []),
      ...(document.imported ? { imported: {
        ...document.imported, instances: step.partIds.flatMap(id => imported.has(id) ? [imported.get(id)!] : []),
      } } : {}),
    };
    lines.push(...new TextDecoder().decode(exportLDR(view)).trimEnd().split(/\r?\n/).slice(2));
    lines.push(step.rotation ? `0 ROTSTEP ${step.rotation.join(" ")} ABS` : "0 STEP");
  }
  lines.push("0 NOFILE");
  for (const [name, section] of Object.entries(originalSections)) {
    lines.push(`0 FILE ${name}`, ...section.filter(line => !/^0\s+NOFILE\s*$/i.test(line)), "0 NOFILE");
  }
  return new TextEncoder().encode(`${lines.join("\r\n")}\r\n`);
}
