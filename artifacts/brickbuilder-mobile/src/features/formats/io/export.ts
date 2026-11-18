import type { BuilderDocument } from "@/features/editor/model";
import { exportMPD } from "../mpd/export";
import { readZip, writeZip } from "../zip";
import { effectiveInstructions, instructionExportNeeded } from "@/features/instructions/model";
import { writeStudioInstructions } from "@/features/instructions/studio";
export function exportIO(document: BuilderDocument): Uint8Array {
  const model = document.imported;
  const rebuildInstructions = instructionExportNeeded(document);
  if (model?.format === "io" && !model.edited && !rebuildInstructions && !document.bricks.length) {
    return new Uint8Array(model.originalBytes);
  }
  const entries = model?.format === "io"
    ? readZip(new Uint8Array(model.originalBytes), { studioEncryption: true })
    : Object.create(null) as Record<string, Uint8Array>;
  const encode = (text: string) => new TextEncoder().encode(text);
  const modified = model?.edited || rebuildInstructions || document.bricks.length;
  // Studio's derived model variants must never silently override the edited model.
  for (const key of Object.keys(entries)) {
    if (modified && /^(modelv2\.ldr|model2\.ldr|model\.lxfml)$/i.test(key)) {
      const backup = `BrickBuilder/original/${key}`;
      if (!entries[backup]) entries[backup] = entries[key];
      delete entries[key];
    }
    if (key.toLowerCase() === "model.ldr") delete entries[key];
    if (rebuildInstructions && key.toLowerCase() === "model.ins") {
      entries["BrickBuilder/original/model.ins"] ??= entries[key];
      delete entries[key];
    }
  }
  entries["model.ldr"] = exportMPD(document);
  if (rebuildInstructions || !Object.keys(entries).some(name => name.toLowerCase() === "model.ins")) {
    entries["model.ins"] = encode(writeStudioInstructions(effectiveInstructions(document)));
  }
  entries["BrickBuilder/export.json"] = encode(JSON.stringify({
    application: "BrickBuilder",
    exportScope: rebuildInstructions
      ? "Edited instance-specific LDraw construction steps and a regenerated one-step-per-page instruction layout. Original source sections and superseded Studio files are retained as backups."
      : "Edited LDraw assembly with original instruction layout preserved. Derived Studio model variants are retained as backups, not as active models.",
    limitations: "Not a lossless Studio page-designer round trip. Callouts, buffer exchanges and proprietary layout operations are not editable in BrickBuilder.",
  }));
  if (!Object.keys(entries).some(name => name.toLowerCase() === ".info")) {
    entries[".info"] = encode(JSON.stringify({ application: "BrickBuilder" }));
  }
  const bytes = writeZip(entries);
  // Apply our ordinary archive safety/size limits to generated files too.
  readZip(bytes, { names: ["model.ldr"] });
  return bytes;
}
