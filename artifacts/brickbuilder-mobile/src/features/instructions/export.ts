import type { BuilderDocument } from "../editor/model";
import { structuredMPD } from "../formats/mpd/structure";
import { effectiveInstructions } from "./model";

/** Reuse the occurrence-aware assembly exporter for instruction-step slices. */
export function exportInstructionMPD(document: BuilderDocument): Uint8Array {
  return new TextEncoder().encode(structuredMPD(document, effectiveInstructions(document)));
}
