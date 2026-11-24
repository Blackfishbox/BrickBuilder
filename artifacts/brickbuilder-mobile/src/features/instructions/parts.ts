import { BRICK_DEFINITIONS, type BuilderDocument } from "../editor/model";
import { resolveColor } from "../formats/colors";
import { IDENTITY } from "../formats/ldraw/parser";
import { reuseGeometryCache } from "../engine/ldraw-geometry";

type ImportedPart = NonNullable<BuilderDocument["imported"]>["instances"][number];
type LegacyPart = BuilderDocument["bricks"][number];
export type InstructionPart = {
  key: string;
  number: string;
  colorName: string;
  colorHex: string;
  count: number;
} & ({ kind: "imported"; part: ImportedPart } | { kind: "legacy"; part: LegacyPart });

export function instructionColorLabel(name: string): string {
  return name.replaceAll("_", " ");
}

export function instructionStepNumber(number: number): string {
  return `${number}.`;
}

/** Count occurrences, but only combine identical geometry references and colors. */
export function instructionPartGroups(document: BuilderDocument, ids: string[]): InstructionPart[] {
  const selected = new Set(ids), groups = new Map<string, InstructionPart>();
  const add = (entry: InstructionPart) => {
    const existing = groups.get(entry.key);
    if (existing) existing.count++;
    else groups.set(entry.key, entry);
  };
  for (const part of document.imported?.instances ?? []) {
    if (!selected.has(part.id)) continue;
    const color = part.color ?? resolveColor(part.colorCode);
    add({
      kind: "imported", part, count: 1,
      key: JSON.stringify(["imported", part.reference.replaceAll("\\", "/").toLowerCase(), part.colorCode, color?.hex, part.part.brickLinkId, part.part.status]),
      number: part.part.brickLinkId ?? `LDraw ${part.part.ldrawId}`,
      colorName: color?.name ?? `LDraw ${part.colorCode}`, colorHex: color?.hex ?? "#ff00ff",
    });
  }
  for (const part of document.bricks) {
    if (!selected.has(part.id)) continue;
    add({
      kind: "legacy", part, count: 1,
      key: JSON.stringify(["legacy", part.type, part.color.toLowerCase()]),
      number: `LDraw ${BRICK_DEFINITIONS[part.type].ldrawId}`,
      colorName: part.color, colorHex: part.color,
    });
  }
  return [...groups.values()];
}

/** Canonical orientation and local resources, never the occurrence's build pose. */
export function instructionPartDocument(document: BuilderDocument, entry: InstructionPart): BuilderDocument {
  if (entry.kind === "legacy") return {
    ...document, instructions: undefined, imported: undefined,
    bricks: [{ ...entry.part, x: 0, y: 0, z: 0, rotation: 0, tiltX: 0, tiltZ: 0 }],
  };
  if (!document.imported) throw new Error("Projektgeometrie fehlt.");
  const imported: NonNullable<BuilderDocument["imported"]> = { ...document.imported, instances: [{ ...entry.part, matrix: [...IDENTITY] }] };
  reuseGeometryCache(document.imported, imported);
  return { ...document, instructions: undefined, bricks: [], imported };
}
