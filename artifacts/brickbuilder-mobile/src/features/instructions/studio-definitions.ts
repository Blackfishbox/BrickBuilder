import type { ImportedModel } from "../formats/types";
import { readZip } from "../formats/zip";

const archivedDefinitions = new WeakMap<number[], ReadonlySet<string>>();

/**
 * CustomParts assemblies are expanded for rendering, but Studio counts them as
 * atomic parts, not instruction submodels. Consult the original archive so this
 * also works for projects saved before that distinction was implemented.
 */
export function studioInstructionDefinitions(model: ImportedModel): ReadonlySet<string> {
  const bytes = model.originalBytes;
  if (model.format !== "io" || bytes?.[0] !== 0x50 || bytes[1] !== 0x4b) {
    return new Set(Object.keys(model.sections));
  }
  const cached = archivedDefinitions.get(bytes);
  if (cached) return cached;
  const entries = readZip(Uint8Array.from(bytes), { names: ["model.ldr"], studioEncryption: true });
  const entry = Object.entries(entries).find(([name]) => name.toLowerCase() === "model.ldr")?.[1];
  if (!entry) throw new Error("IO-Archiv ohne ursprüngliche Modellquelle.");
  const source = new TextDecoder("utf-8", { fatal: true }).decode(entry).replace(/^\uFEFF/, "");
  const names = new Set([...source.matchAll(/^0\s+FILE\s+(.+)$/gmi)]
    .map(match => match[1].trim().toLowerCase().replaceAll("\\", "/")));
  if (!names.size) names.add(model.root);
  archivedDefinitions.set(bytes, names);
  return names;
}
