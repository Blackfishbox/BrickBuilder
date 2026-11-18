import { readZip } from "../zip";
import { importLDraw } from "../ldraw/import";
import type { ResolveOptions } from "../online-geometry";
import { readStudioInstructions } from "@/features/instructions/studio";
import { includeIOAssemblies, readIOAssemblies, readIOGeometry } from "./assemblies";

export async function importIO(bytes: Uint8Array, filename: string, options: ResolveOptions = {}) {
  const entries = readZip(bytes, { names: ["model.ldr", "model.ins"],
    select: name => /^CustomParts\/.+\.dat$/i.test(name), studioEncryption: true });
  const modelName = Object.keys(entries).find(name => name.toLowerCase() === "model.ldr");
  if (!modelName) throw new Error("IO-Variante ohne model.ldr wird nicht unterstützt.");
  const assemblies = readIOAssemblies(entries);
  const document = await importLDraw(includeIOAssemblies(entries[modelName], assemblies), filename, "io", bytes, options,
    readIOGeometry(entries, assemblies));
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
