import { readZip } from "../zip";
import { importLDraw } from "../ldraw/import";
import type { ResolveOptions } from "../online-geometry";
import { readStudioInstructions } from "@/features/instructions/studio";
import { createIOEntrySkipPolicy, includeIOAssemblies, readIOAssemblies, readIOGeometry, type IOSkipReason } from "./assemblies";

export async function importIO(bytes: Uint8Array, filename: string, options: ResolveOptions = {}) {
  const skippedEntries: { name: string; reason: string }[] = [];
  const skipEntry = createIOEntrySkipPolicy();
  const entries = readZip(bytes, { names: ["model.ldr", "model.ins"],
    select: name => /^CustomParts\/.+\.dat$/i.test(name), studioEncryption: true,
    skipEntry: (name, size) => skipEntry(name, size),
    onSkippedEntry: (name, _size, reason) => skippedEntries.push({ name, reason }),
  });
  const modelName = Object.keys(entries).find(name => name.toLowerCase() === "model.ldr");
  if (!modelName) throw new Error("IO-Variante ohne model.ldr wird nicht unterstützt.");
  const assemblies = readIOAssemblies(entries);
  const skippedGeometry = new Map<string, IOSkipReason>();
  const resources = readIOGeometry(entries, assemblies, (archivePath, reason) => skippedGeometry.set(archivePath, reason));
  const document = await importLDraw(includeIOAssemblies(entries[modelName], assemblies), filename, "io", bytes, options,
    resources);
  for (const skipped of skippedEntries) {
    if (skipped.reason === "io-geometry-file-limit" || skipped.reason === "io-geometry-total-limit") {
      document.imported!.issues.push({
        code: skipped.reason,
        reference: skipped.name.slice("CustomParts/".length),
        message: `CustomParts-Geometrie übersprungen: ${skipped.name} (${skipped.reason}). Quelldatei und übriges Modell bleiben erhalten.`,
      });
    } else if (skipped.reason === "io-instructions-limit") {
      document.imported!.issues.push({
        code: skipped.reason,
        message: `Studio-Anleitungsdaten überschreiten ${8} MiB und wurden übersprungen; das Modell wurde importiert.`,
      });
    }
  }
  for (const [archivePath, reason] of skippedGeometry) {
    document.imported!.issues.push({
      code: reason,
      reference: archivePath.slice("CustomParts/".length),
      message: `CustomParts-Geometrie übersprungen: ${archivePath} (${reason}). Quelldatei und übriges Modell bleiben erhalten.`,
    });
  }
  const instructionName = Object.keys(entries).find(name => name.toLowerCase() === "model.ins");
  if (instructionName && document.instructions) {
    try {
      document.instructions = readStudioInstructions(new TextDecoder("utf-8", { fatal: true }).decode(entries[instructionName]), document.instructions);
    } catch (error) {
      document.instructions.warnings.push(error instanceof Error ? error.message : "Studio-Anleitung konnte nicht ausgewertet werden.");
    }
  }
  document.imported!.issues.push({
    code: "io-scope", message: `IO: Bauschritte aus model.ldr sind bearbeitbar.${Object.keys(assemblies).length ? ` ${Object.keys(assemblies).length} eingebettete Referenz-Baugruppen wurden erschlossen.` : ""} Studio-Seitenlayouts, LXFML und zusätzliche Ressourcen bleiben im Originalarchiv erhalten. Studio-Layoutfunktionen werden nicht vollständig nachgebildet.`,
  });
  return document;
}
