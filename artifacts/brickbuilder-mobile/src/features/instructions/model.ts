import type { BuilderDocument } from "../editor/model";
import type { ImportedModel } from "../formats/types";
import type { InstructionCallout, InstructionPlan, InstructionStep } from "./types";
import { readStudioInstructions } from "./studio";
import { INSTRUCTION_ROOT } from "../formats/mpd/instruction-partition";

const boundary = /^\s*0\s+(?:STEP|ROTSTEP)(?:\s|$)/i;

export function instructionPartIds(document: BuilderDocument): string[] {
  return [...document.bricks.map(part => part.id), ...(document.imported?.instances.map(part => part.id) ?? [])];
}

export function instructionExportNeeded(document: BuilderDocument): boolean {
  if (document.instructions?.edited && !instructionStepsUnchanged(document)) return true;
  if (!document.instructions) return false;
  const assigned = new Set(document.instructions.steps.flatMap(step => step.partIds));
  return instructionPartIds(document).some(id => !assigned.has(id));
}

/** Layout-only changes must not flatten the source model or invalidate native indices. */
export function instructionStepsUnchanged(document: BuilderDocument): boolean {
  const layout = document.instructions?.studioLayout, model = document.imported;
  if (!layout || !model || model.format !== "io") return false;
  const original = readStudioInstructions(layout.sourceXml, sourceInstructionPlan(model));
  return JSON.stringify(original.steps) === JSON.stringify(document.instructions!.steps);
}

/** Resolve by occurrence, never by part number: identical parts may belong to different steps. */
export function sourceInstructionPlan(model: ImportedModel): InstructionPlan {
  const steps: InstructionStep[] = [];
  // Generated slices retain assembly nesting, but only the explicit root
  // boundaries define construction steps, including deliberately empty ones.
  const explicitRoot = model.sections[model.root]?.includes(INSTRUCTION_ROOT);
  const available = new Map(model.instances.map(part => [part.sourceOccurrence?.join("/"), part.id]));
  const idsByPrefix = new Map<string, string[]>();
  for (const part of model.instances) {
    const path = part.sourceOccurrence;
    if (!path) continue;
    for (let depth = 1; depth <= path.length; depth++) {
      const prefix = path.slice(0, depth).join("/");
      const ids = idsByPrefix.get(prefix) ?? [];
      ids.push(part.id); idsByPrefix.set(prefix, ids);
    }
  }
  let serializedIndex = 0;
  const studioIndices = new Map<string, number>();
  function visit(name: string, occurrence: number[], ancestors: string[]) {
    if (ancestors.includes(name) || ancestors.length > 48) throw new Error("Zyklische Anleitungshierarchie.");
    let parts: string[] = [];
    let pendingCallouts: InstructionCallout[] = [];
    let title: string | undefined, notes = "";
    let rotation: [number, number, number] | undefined;
    let localStep = 0;
    const finish = (allowEmpty = false) => {
      if (!parts.length && !pendingCallouts.length && !allowEmpty) return;
      // Studio serializes each submodel definition once, even when that
      // definition is built at several occurrences in the flattened plan.
      const key = `${name}:${localStep++}`;
      const sourceIndex = model.format === "io"
        ? studioIndices.get(key) ?? serializedIndex++ : serializedIndex++;
      if (model.format === "io") studioIndices.set(key, sourceIndex);
      steps.push({
        id: `imported-step-${steps.length}`, title: title ?? `Schritt ${steps.length + 1}`,
        notes, partIds: parts, sourceIndex, sourceAssembly: [...occurrence],
        ...(pendingCallouts.length ? { callouts: [...pendingCallouts] } : {}),
        ...(rotation ? { rotation } : {}),
      });
      parts = []; pendingCallouts = [];
      title = undefined; notes = "";
      if (explicitRoot) rotation = undefined;
    };
    for (const [index, line] of (model.sections[name] ?? []).entries()) {
      const own = line.match(/^\s*0\s+!BRICKBUILDER\s+(TITLE|NOTE)\s+(.+)$/);
      if (own) {
        try {
          const value: unknown = JSON.parse(own[2]);
          if (typeof value === "string") {
            if (own[1] === "TITLE") title = value.slice(0, 160);
            else notes = value.slice(0, 2000);
          }
        } catch { /* Preserve an unknown comment without interpreting it. */ }
        continue;
      }
      if (boundary.test(line) && (!explicitRoot || !occurrence.length)) {
        const match = line.match(/^\s*0\s+ROTSTEP\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)/i);
        if (match) {
          const values = match.slice(1).map(Number);
          if (values.every(Number.isFinite)) rotation = values as [number, number, number];
        }
        finish(true);
        continue;
      }
      if (!/^\s*1\s/.test(line)) continue;
      const path = [...occurrence, index], id = available.get(path.join("/"));
      if (id) { parts.push(id); continue; }
      const reference = line.trim().split(/\s+/).slice(14).join(" ").replaceAll("\\", "/");
      const target = reference.toLowerCase();
      if (Object.hasOwn(model.sections, target)) {
        // Build each subassembly before it is used by its parent occurrence.
        if (!explicitRoot && parts.length) finish();
        if (explicitRoot) {
          collect(target, path, [...ancestors, name], parts);
        } else {
          visit(target, path, [...ancestors, name]);
          const descendantIds = idsByPrefix.get(path.join("/"));
          if (descendantIds?.length) {
            const file = reference.split("/").pop()?.replace(/\.ldr$/i, "") ?? target;
            const label = file.split(" - ").at(-1)?.trim() || file;
            pendingCallouts.push({ id: path.join("/"), title: label.slice(0, 160), occurrence: path });
          }
        }
      }
    }
    if (parts.length || !steps.length) finish(true);
    if (pendingCallouts.length && occurrence.length) {
      const last = steps.at(-1);
      if (last) last.callouts = [...(last.callouts ?? []), ...pendingCallouts];
    }
  }
  function collect(name: string, occurrence: number[], ancestors: string[], parts: string[]) {
    if (ancestors.includes(name) || ancestors.length > 48) throw new Error("Zyklische Anleitungshierarchie.");
    for (const [index, line] of (model.sections[name] ?? []).entries()) {
      if (!/^\s*1\s/.test(line)) continue;
      const path = [...occurrence, index], id = available.get(path.join("/"));
      if (id) { parts.push(id); continue; }
      const target = line.trim().split(/\s+/).slice(14).join(" ").replaceAll("\\", "/").toLowerCase();
      if (Object.hasOwn(model.sections, target)) collect(target, path, [...ancestors, name], parts);
    }
  }
  visit(model.root, [], []);
  const assigned = new Set(steps.flatMap(step => step.partIds));
  const remaining = model.instances.filter(part => !assigned.has(part.id)).map(part => part.id);
  if (remaining.length) steps[steps.length - 1].partIds.push(...remaining);
  return { version: 1, edited: false, source: "ldraw", steps, warnings: [] };
}

/** Keep old projects usable, discard deleted parts, and include newly added parts. */
export function effectiveInstructions(document: BuilderDocument): InstructionPlan {
  let base = document.instructions ?? (document.imported ? sourceInstructionPlan(document.imported) : {
    version: 1 as const, edited: false, source: "manual" as const,
    steps: [{ id: "first-step", title: "Schritt 1", notes: "", partIds: [] }], warnings: [],
  });
  // Rebuild untouched imported plans after importer corrections, including saved
  // projects. Never reinterpret user-edited step membership.
  if (document.imported && base.source === "studio" && !base.edited && base.studioLayout) {
    const layout = base.studioLayout;
    base = { ...readStudioInstructions(layout.sourceXml, sourceInstructionPlan(document.imported)), studioLayout: layout };
  }
  const ids = instructionPartIds(document), live = new Set(ids), assigned = new Set<string>();
  const steps = base.steps.map(step => ({
    ...step, partIds: step.partIds.filter(id => {
      if (!live.has(id) || assigned.has(id)) return false;
      assigned.add(id); return true;
    }),
  }));
  if (!steps.length) steps.push({ id: crypto.randomUUID(), title: "Schritt 1", notes: "", partIds: [] });
  steps[steps.length - 1].partIds.push(...ids.filter(id => !assigned.has(id)));
  return { ...base, steps };
}

export function updateInstructions(document: BuilderDocument, plan: InstructionPlan): BuilderDocument {
  const ids = new Set<string>(), steps = new Set<string>();
  for (const step of plan.steps) {
    if (steps.has(step.id)) throw new Error("Doppelte Anleitungsschritte.");
    steps.add(step.id);
    for (const id of step.partIds) {
      if (ids.has(id)) throw new Error("Ein Teil darf nur einem Anleitungsschritt zugeordnet sein.");
      ids.add(id);
    }
  }
  return { ...document, instructions: { ...plan, edited: true }, updatedAt: new Date().toISOString() };
}

export function instructionView(document: BuilderDocument, plan: InstructionPlan, index: number): BuilderDocument {
  const visible = new Set(plan.steps.slice(0, index + 1).flatMap(step => step.partIds));
  return {
    ...document, bricks: document.bricks.filter(part => visible.has(part.id)),
    ...(document.imported ? { imported: {
      ...document.imported, instances: document.imported.instances.filter(part => visible.has(part.id)),
    } } : {}),
  };
}
