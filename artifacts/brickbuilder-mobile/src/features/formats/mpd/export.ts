import type { BuilderDocument } from "@/features/editor/model";
import { structuredMPD } from "./structure";
import { exportInstructionMPD } from "@/features/instructions/export";
import { instructionExportNeeded } from "@/features/instructions/model";
export function exportMPD(document: BuilderDocument): Uint8Array {
  if (instructionExportNeeded(document)) return exportInstructionMPD(document);
  // Untouched source remains byte-for-byte text compatible.
  if (document.imported && !document.imported.edited && !document.bricks.length) return new TextEncoder().encode(document.imported.sourceText);
  return new TextEncoder().encode(structuredMPD(document));
}
