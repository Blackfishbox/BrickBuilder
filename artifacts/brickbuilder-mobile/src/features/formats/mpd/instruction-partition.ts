import type { ImportedInstance } from "../types";
import { referenceLine } from "../ldraw/parser";
import type { InstructionPlan } from "@/features/instructions/types";

export const INSTRUCTION_ROOT = "0 !BRICKBUILDER INSTRUCTION_ROOT 1";
export const occurrenceKey = (path: number[]) => path.join("/");

/**
 * Partition occurrences, not definitions. Inline geometry has no editable part
 * ID, so it belongs to the earliest surviving descendant step (or its parent's
 * owner when there are no surviving descendants). Never duplicate that geometry
 * when an assembly is split across steps.
 */
export function instructionPartition(
  sections: Record<string, string[]>, root: string,
  effective: Map<string, ImportedInstance>, plan: InstructionPlan,
) {
  const stepById = new Map(plan.steps.flatMap((step, index) => step.partIds.map(id => [id, index] as const)));
  const members = new Map<string, Set<number>>();
  for (const [key, instance] of effective) {
    const step = stepById.get(instance.id);
    if (step === undefined) throw new Error("Export: Teil ohne Anleitungsschritt.");
    const path = key.split("/");
    for (let depth = 0; depth <= path.length; depth++) {
      const prefix = path.slice(0, depth).join("/");
      if (!members.has(prefix)) members.set(prefix, new Set());
      members.get(prefix)!.add(step);
    }
  }
  const geometryOwners = new Map<string, number>();
  function visit(name: string, path: number[], inheritedOwner: number): Set<number> {
    const key = occurrenceKey(path), steps = members.get(key) ?? new Set<number>();
    // Resolve before including geometry-only children, so their traversal order
    // cannot change ownership of a sibling's surfaces.
    const owner = steps.size ? Math.min(...steps) : inheritedOwner;
    geometryOwners.set(key, owner);
    if (!steps.size || sections[name].some(line => /^\s*[2-5]\s/.test(line))) steps.add(owner);
    for (const [index, line] of sections[name].entries()) {
      if (!/^\s*1\s/.test(line)) continue;
      const target = referenceLine(line).reference.toLowerCase();
      if (!Object.hasOwn(sections, target)) continue;
      for (const step of visit(target, [...path, index], owner)) steps.add(step);
    }
    members.set(key, steps);
    return steps;
  }
  visit(root, [], plan.steps.length - 1);
  return {
    stepById,
    includes: (path: number[], step: number) => members.get(occurrenceKey(path))?.has(step) ?? false,
    ownsGeometry: (path: number[], step: number) => geometryOwners.get(occurrenceKey(path)) === step,
  };
}
