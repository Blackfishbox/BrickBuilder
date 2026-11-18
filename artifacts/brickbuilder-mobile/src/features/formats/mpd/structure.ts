import { Matrix4 } from "three";
import type { BuilderDocument } from "@/features/editor/model";
import type { Affine, ImportedInstance } from "../types";
import { IDENTITY, multiply, parseLDraw, referenceLine } from "../ldraw/parser";
import { exportLDR } from "../ldraw/export";
import type { InstructionPlan } from "@/features/instructions/types";
import { INSTRUCTION_ROOT, instructionPartition, occurrenceKey } from "./instruction-partition";

function lineFor(instance: Pick<ImportedInstance, "colorCode" | "matrix" | "reference">): string {
  const m = instance.matrix;
  const line = `1 ${instance.colorCode} ${[m[3], m[7], m[11], m[0], m[1], m[2], m[4], m[5], m[6], m[8], m[9], m[10]].join(" ")} ${instance.reference}`;
  // Never write matrices or references that our own importer would reject.
  referenceLine(line);
  return line;
}

function inverse(m: Affine): Affine | undefined {
  const matrix = new Matrix4().set(...[
    ...m.slice(0, 4), ...m.slice(4, 8), ...m.slice(8, 12), 0, 0, 0, 1,
  ] as Parameters<Matrix4["set"]>);
  if (Math.abs(matrix.determinant()) < 1e-12) return undefined;
  const e = matrix.invert().elements;
  return [e[0], e[4], e[8], e[12], e[1], e[5], e[9], e[13], e[2], e[6], e[10], e[14]];
}

const sourceKey = (instance: ImportedInstance) => JSON.stringify(instance.sourcePath);

/** Rebuild occurrence-specific variants without modifying the archived source. */
export function structuredMPD(document: BuilderDocument, instructions?: InstructionPlan): string {
  const model = document.imported;
  if (!model) {
    const text = new TextDecoder().decode(exportLDR(document));
    if (!instructions) return `0 FILE main.ldr\r\n${text}0 NOFILE\r\n`;
    const lines = ["0 FILE main.ldr", INSTRUCTION_ROOT];
    for (const step of instructions.steps) {
      const ids = new Set(step.partIds);
      const view = new TextDecoder().decode(exportLDR({ ...document, bricks: document.bricks.filter(i => ids.has(i.id)) }));
      lines.push(`0 !BRICKBUILDER TITLE ${JSON.stringify(step.title)}`,
        `0 !BRICKBUILDER NOTE ${JSON.stringify(step.notes)}`,
        ...view.split(/\r?\n/).filter(line => /^1 /.test(line)),
        step.rotation ? `0 ROTSTEP ${step.rotation.join(" ")} ABS` : "0 STEP");
    }
    return `${lines.join("\r\n")}\r\n0 NOFILE\r\n`;
  }
  const source = parseLDraw(model.sourceText);
  const originals = new Map(source.instances.map(i => [occurrenceKey(i.sourceOccurrence!), i]));
  const bySource = new Map<string, ImportedInstance[]>();
  for (const instance of source.instances) {
    const key = sourceKey(instance);
    bySource.set(key, [...(bySource.get(key) ?? []), instance]);
  }
  const effective = new Map<string, ImportedInstance>();
  const additions: ImportedInstance[] = [];
  for (const instance of model.instances) {
    let key: string | undefined;
    if (instance.sourceOccurrence) {
      key = occurrenceKey(instance.sourceOccurrence);
      if (!originals.has(key)) throw new Error("Export: ungültige Vorkommenskennung. Bitte JSON-Projektsicherung behalten.");
    } else {
      const candidates = bySource.get(sourceKey(instance)) ?? [];
      if (candidates.length > 1) {
        throw new Error("Export: Dieser ältere Projektstand unterscheidet wiederholte Untermodelle nicht eindeutig. Bitte JSON sichern; ein sicherer MPD-/IO-Export ist nicht möglich.");
      }
      key = candidates[0] ? occurrenceKey(candidates[0].sourceOccurrence!) : undefined;
    }
    if (key === undefined) additions.push(instance);
    else {
      if (effective.has(key)) throw new Error("Export: doppelte Vorkommenskennung.");
      effective.set(key, instance);
    }
  }
  const partition = instructions ? instructionPartition(source.sections, source.root, effective, instructions) : undefined;

  // Keep even unreferenced original sections: they may contain custom geometry,
  // legal notices or unknown metadata. NOFILE is a container delimiter only.
  const clean = (lines: string[]) => lines.filter(line => !/^0\s+NOFILE\s*$/i.test(line));
  const output = new Map(Object.entries(source.sections).map(([name, lines]) => [name, clean(lines)]));
  // Generated section names must not shadow any external reference either.
  const reserved = new Set(output.keys());
  for (const lines of output.values()) {
    for (const line of lines) {
      if (/^\s*1\s/.test(line)) reserved.add(referenceLine(line).reference.toLowerCase());
    }
  }
  for (const instance of model.instances) reserved.add(instance.reference.toLowerCase());
  const variants = new Map<string, Map<string, string>>();
  for (const [name, lines] of output) variants.set(name, new Map([[JSON.stringify(lines), name]]));
  let lifted: string[] = [];
  let stepRootLines: string[] = [];
  let serial = 0;
  function allocate(): string {
    let name: string;
    do { name = `brickbuilder-${++serial}.ldr`; } while (reserved.has(name));
    reserved.add(name);
    return name;
  }
  function visit(name: string, parent: Affine, color: string, path: number[], root = false, ancestorInvert = false, step?: number): string {
    const lines: string[] = [];
    let parentInverse: Affine | undefined;
    let invertIndex: number | undefined;
    for (const [index, line] of source.sections[name].entries()) {
      if (/^0\s+NOFILE\s*$/i.test(line)) continue;
      if (!/^\s*1\s/.test(line)) {
        if (partition && (
          /^\s*0\s+(?:STEP|ROTSTEP)(?:\s|$)/i.test(line) ||
          /^\s*0\s+!BRICKBUILDER\s+(?:TITLE|NOTE|INSTRUCTION_ROOT)(?:\s|$)/i.test(line)
        )) continue;
        if (partition && /^\s*[2-5]\s/.test(line) && !partition.ownsGeometry(path, step!)) {
          // A primitive consumes a pending INVERTNEXT even when this slice does
          // not own that primitive.
          if (invertIndex !== undefined) lines.splice(invertIndex, 1);
          invertIndex = undefined;
          continue;
        }
        if (/^\s*0\s+BFC\s+INVERTNEXT\s*$/i.test(line)) invertIndex = lines.length;
        else if (/^\s*[2-5]\s/.test(line)) invertIndex = undefined;
        lines.push(line); continue;
      }
      const occurrence = [...path, index];
      if (partition && !partition.includes(occurrence, step!)) {
        if (invertIndex !== undefined) lines.splice(invertIndex, 1);
        invertIndex = undefined;
        continue;
      }
      const ref = referenceLine(line);
      const world = multiply(parent, ref.matrix);
      const inherited = ref.color === "16" ? color : ref.color;
      const target = ref.reference.toLowerCase();
      const inverted = ancestorInvert !== (invertIndex !== undefined);
      const removeInvert = () => { if (invertIndex !== undefined) lines.splice(invertIndex, 1); };
      const lift = (instance: ImportedInstance) => {
        removeInvert();
        if (inverted) lifted.push("0 BFC INVERTNEXT");
        lifted.push(lineFor(instance));
      };
      if (Object.hasOwn(source.sections, target)) {
        const variant = visit(target, world, inherited, occurrence, false, inverted, step);
        lines.push(variant === target ? line : lineFor({ colorCode: ref.color, matrix: ref.matrix, reference: variant }));
      } else {
        const key = occurrenceKey(occurrence), current = effective.get(key);
        if (!current || (partition && partition.stepById.get(current.id) !== step)) {
          removeInvert();
          invertIndex = undefined;
          continue; // Deleted occurrence, not every use of this section.
        }
        const original = originals.get(key)!;
        if (current.reference === original.reference && current.colorCode === original.colorCode &&
          current.matrix.every((value, i) => value === original.matrix[i])) {
          lines.push(line);
        } else {
          parentInverse ??= inverse(parent);
          if (!parentInverse || (current.colorCode === "16" && color !== "16")) {
            // A singular ancestor cannot express arbitrary world-space edits.
            // Lift this leaf only; keep ancestor inline surfaces and metadata.
            lift(current);
          } else {
            try {
              lines.push(lineFor({ ...current, matrix: multiply(parentInverse, current.matrix) }));
            } catch {
              // Ill-conditioned transforms may exceed LDraw's safe local range.
              lift(current);
            }
          }
        }
      }
      invertIndex = undefined;
    }
    if (root) {
      // A dangling source INVERTNEXT must not accidentally apply to an addition.
      if (invertIndex !== undefined && (partition || additions.length || lifted.length || document.bricks.length)) lines.splice(invertIndex, 1);
      lines.push(...additions.filter(i => !partition || partition.stepById.get(i.id) === step).map(lineFor), ...lifted);
      const legacy = new TextDecoder().decode(exportLDR({ ...document, imported: undefined,
        bricks: document.bricks.filter(i => !partition || partition.stepById.get(i.id) === step),
      }));
      lines.push(...legacy.split(/\r?\n/).filter(line => /^1 /.test(line)));
      if (!partition) {
        output.set(name, lines);
        return name;
      }
      // Keep the original root's local frame at root. An extra wrapper section
      // per step wastes section/depth budgets on large instruction sequences.
      stepRootLines = lines;
      return name;
    }
    const signature = JSON.stringify(lines), known = variants.get(name)!;
    const reused = known.get(signature);
    if (reused) return reused;
    const variant = allocate();
    known.set(signature, variant);
    output.set(variant, lines);
    if (output.size + (instructions ? 1 : 0) > 1024) {
      throw new Error("Export: mehr als 1.024 Abschnitte durch Einzeländerungen. Bitte JSON-Projektsicherung verwenden.");
    }
    return variant;
  }
  let activeRoot = source.root;
  if (instructions) {
    activeRoot = allocate();
    const lines = [INSTRUCTION_ROOT];
    for (const [step, instruction] of instructions.steps.entries()) {
      lifted = [];
      visit(source.root, IDENTITY, "16", [], true, false, step);
      lines.push(`0 !BRICKBUILDER TITLE ${JSON.stringify(instruction.title)}`,
        `0 !BRICKBUILDER NOTE ${JSON.stringify(instruction.notes)}`,
        "0 BFC NOCERTIFY", "0 BFC CLIP CCW", ...stepRootLines,
        instruction.rotation ? `0 ROTSTEP ${instruction.rotation.join(" ")} ABS` : "0 STEP");
    }
    output.set(activeRoot, lines);
  } else visit(source.root, IDENTITY, "16", [], true);
  // Root must be first regardless of source section insertion order.
  const names = [activeRoot, ...[...output.keys()].filter(name => name !== activeRoot)];
  if (names.length > 1024) throw new Error(`Export: ${names.length} Abschnitte durch Einzeländerungen (Grenze: 1.024). Bitte JSON-Projektsicherung verwenden.`);
  const sourceLines = model.sourceText.replace(/^\uFEFF/, "").split(/\r?\n/);
  const firstFile = sourceLines.findIndex(line => /^0\s+FILE\s+.+$/i.test(line));
  const preamble = firstFile > 0 ? sourceLines.slice(0, firstFile).join("\r\n") + "\r\n" : "";
  const text = preamble + names.map(name => `0 FILE ${name}\r\n${output.get(name)!.join("\r\n")}\r\n0 NOFILE\r\n`).join("");
  if (text.length > 16 * 1024 * 1024) throw new Error("Export: MPD überschreitet 16 MiB. Bitte JSON-Projektsicherung verwenden.");
  return text;
}
