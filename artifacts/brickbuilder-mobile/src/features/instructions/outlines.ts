import { Box3, Camera, Matrix4, Vector3 } from "three";
import type { Brick, BuilderDocument } from "../editor/model";
import { brickTransformMatrix } from "../editor/brick-transform";
import { brickConstructionBounds } from "../engine/construction-floor";
import { localPartBounds, stackingBounds } from "../engine/stacking";
import { worldMatrix } from "../engine/ldraw-geometry";

export interface InstructionHighlightOccurrence {
  id: string;
  identity: string;
  bounds: Box3;
  frame?: InstructionOutlineFrame;
}
export interface InstructionOutlineFrame {
  bounds: Box3;
  transform: Matrix4;
}
export interface InstructionHighlightGroup {
  ids: string[];
  bounds: Box3;
}

/**
 * 0.1 stud (2 LDU): covers the intentional body clearance of local renderers
 * (up to 0.08 stud), not a placement/snap distance. Test original occurrence
 * bounds only: an enclosing group box must never bridge empty space.
 */
export const INSTRUCTION_CONTACT_TOLERANCE = 0.1;

/** Presentation-only connected components, partitioned by real geometry/color. */
export function groupInstructionHighlights(
  occurrences: Iterable<InstructionHighlightOccurrence>,
  highlighted: ReadonlySet<string>,
): InstructionHighlightGroup[] {
  const partitions = new Map<string, InstructionHighlightOccurrence[]>();
  for (const occurrence of occurrences) {
    if (!highlighted.has(occurrence.id) || occurrence.bounds.isEmpty()) continue;
    const entries = partitions.get(occurrence.identity) ?? [];
    entries.push(occurrence); partitions.set(occurrence.identity, entries);
  }
  const groups: InstructionHighlightGroup[] = [];
  const tolerance = INSTRUCTION_CONTACT_TOLERANCE;
  for (const entries of partitions.values()) {
    const parent = entries.map((_, i) => i);
    const root = (i: number): number => {
      while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; }
      return i;
    };
    // Sweep the widest model axis, so distant parts do not incur an
    // unconditional quadratic scan (including tall or long, narrow builds).
    const extent = new Box3();
    for (const entry of entries) extent.union(entry.bounds);
    const size = extent.getSize(new Vector3());
    const axis = size.x >= size.y && size.x >= size.z ? "x" : size.y >= size.z ? "y" : "z";
    const order = entries.map((_, i) => i).sort((a, b) => entries[a].bounds.min[axis] - entries[b].bounds.min[axis]);
    let active: number[] = [];
    for (const i of order) {
      const box = entries[i].bounds;
      active = active.filter(j => entries[j].bounds.max[axis] + tolerance >= box.min[axis]);
      for (const j of active) {
        const other = entries[j].bounds;
        if (box.min.x <= other.max.x + tolerance && box.max.x + tolerance >= other.min.x &&
            box.min.y <= other.max.y + tolerance && box.max.y + tolerance >= other.min.y &&
            box.min.z <= other.max.z + tolerance && box.max.z + tolerance >= other.min.z) {
          parent[root(i)] = root(j);
        }
      }
      active.push(i);
    }
    const components = new Map<number, InstructionHighlightGroup>();
    entries.forEach((entry, i) => {
      const key = root(i), group = components.get(key) ?? { ids: [], bounds: new Box3() };
      group.ids.push(entry.id); group.bounds.union(entry.bounds); components.set(key, group);
    });
    groups.push(...components.values());
  }
  return groups;
}

/** Stable model-space bounds, independent of camera, material batches and view rotation. */
export function instructionHighlightOccurrences(
  bricks: readonly Brick[], imported?: BuilderDocument["imported"],
): InstructionHighlightOccurrence[] {
  const occurrences: InstructionHighlightOccurrence[] = [];
  for (const brick of bricks) {
    const bounds = brickConstructionBounds(brick);
    occurrences.push({
      id: brick.id, identity: JSON.stringify(["local", brick.type, brick.color.toLowerCase()]), bounds,
      frame: {
        bounds: brickConstructionBounds({ ...brick, x: 0, y: 0, z: 0, rotation: 0, tiltX: 0, tiltZ: 0 }),
        transform: brickTransformMatrix(brick),
      },
    });
  }
  if (imported) {
    const boxes = stackingBounds(imported);
    for (const part of imported.instances) {
      const bounds = boxes.get(part.id);
      if (bounds) occurrences.push({
        id: part.id,
        identity: JSON.stringify(["imported", part.reference.replaceAll("\\", "/").toLowerCase(), part.colorCode]),
        bounds,
        frame: { bounds: localPartBounds(imported, part.reference), transform: worldMatrix(part.matrix) },
      });
    }
  }
  return occurrences;
}

/** Union final diagram-space bounds after membership was decided in model space. */
export function instructionGroupBounds(
  groups: readonly InstructionHighlightGroup[], boxes: ReadonlyMap<string, Box3>,
): Box3[] {
  return groups.map(group => {
    const box = new Box3();
    for (const id of group.ids) {
      const member = boxes.get(id);
      if (member) box.union(member);
    }
    return box;
  }).filter(box => !box.isEmpty());
}

/** Transform box corners, not an already rotated axis-aligned enclosing box. */
export function instructionGroupFrames(
  groups: readonly InstructionHighlightGroup[], occurrences: readonly InstructionHighlightOccurrence[], diagram: Matrix4,
): InstructionOutlineFrame[] {
  const byId = new Map(occurrences.map(part => [part.id, part]));
  return groups.map(group => {
    const frame = group.ids.length === 1 ? byId.get(group.ids[0])?.frame : undefined;
    return {
      bounds: frame?.bounds ?? group.bounds,
      transform: frame ? diagram.clone().multiply(frame.transform) : diagram.clone(),
    };
  });
}

/** Selection-style 3D bounds, projected without allocating a mesh per part. */
export function drawInstructionOutlines(
  context: CanvasRenderingContext2D, camera: Camera, boxes: Iterable<Box3 | InstructionOutlineFrame>, width: number, height: number,
): void {
  context.save();
  context.strokeStyle = "#e32620"; context.lineWidth = 2.6; context.globalAlpha = 1;
  for (const entry of boxes) {
    const box = entry instanceof Box3 ? entry : entry.bounds;
    const points = [];
    for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
      const point = new Vector3(x, y, z);
      if (!(entry instanceof Box3)) point.applyMatrix4(entry.transform);
      points.push(point.project(camera));
    }
    if (points.some(p => !Number.isFinite(p.x) || p.z < -1 || p.z > 1)) continue;
    context.beginPath();
    for (let i = 0; i < 8; i++) for (const bit of [1, 2, 4]) {
      const j = i ^ bit;
      if (j < i) continue;
      context.moveTo((points[i].x + 1) * width / 2, (1 - points[i].y) * height / 2);
      context.lineTo((points[j].x + 1) * width / 2, (1 - points[j].y) * height / 2);
    }
    context.stroke();
  }
  context.restore();
}
