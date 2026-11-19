import { Box3, Vector3 } from "three";
import type { ImportedInstance, ImportedModel } from "../formats/types";
import type { Position3 } from "../editor/model";
import { compilePart, reuseGeometryCache, worldMatrix } from "./ldraw-geometry";
import { importedCollisionQuery } from "./imported-collision";
import type { Affine } from "../formats/types";

const instanceBounds = new WeakMap<ImportedInstance, { resources: ImportedModel["resources"]; box: Box3 }>();
const modelBounds = new WeakMap<ImportedModel, Map<string, Box3>>();
const localBounds = new WeakMap<ImportedModel["resources"], Map<string, Box3>>();

/** Exact local source bounds are shared by collision queries for rotated snaps. */
export function localPartBounds(model: ImportedModel, reference: string): Box3 {
  const cache = localBounds.get(model.resources) ?? new Map<string, Box3>();
  localBounds.set(model.resources, cache);
  const old = cache.get(reference); if (old) return old;
  const box = new Box3(), point = new Vector3();
  for (const surface of compilePart(model, reference, "16")) {
    for (let i = 0; i < surface.positions.length; i += 3) box.expandByPoint(point.fromArray(surface.positions, i));
  }
  cache.set(reference, box); return box;
}

/** Conservative broad-phase bounds, cached independently of temporary drag previews. */
export function stackingBounds(model: ImportedModel): Map<string, Box3> {
  const cached = modelBounds.get(model);
  if (cached) return cached;
  const result = new Map<string, Box3>();
  for (const instance of model.instances) {
    if (instance.part.status !== "resolved") continue;
    let entry = instanceBounds.get(instance);
    if (!entry || entry.resources !== model.resources) {
      let box: Box3;
        try { box = localPartBounds(model, instance.reference); }
        catch {
          // Missing geometry is already reported by import diagnostics; it cannot
          // supply a collision volume and must not prevent editing valid parts.
          continue;
        }
      entry = { resources: model.resources, box: box.clone().applyMatrix4(worldMatrix(instance.matrix)) };
      instanceBounds.set(instance, entry);
    }
    if (!entry.box.isEmpty()) result.set(instance.id, entry.box);
  }
  modelBounds.set(model, result);
  return result;
}

/** Placement only extends validated resources; keep existing bounds and geometry warm. */
export function inheritStackingBounds(previous: ImportedModel | undefined, next: ImportedModel): void {
  if (!previous) return;
  reuseGeometryCache(previous, next);
  const boxes = stackingBounds(previous);
  for (const instance of previous.instances) {
    const box = boxes.get(instance.id);
    if (box) instanceBounds.set(instance, { resources: next.resources, box });
  }
}

/** Raise only actual overlaps; moving away recomputes from the user's original height. */
export function liftOverlaps(moving: Box3, obstacles: Iterable<Box3>): number {
  const epsilon = 0.0001;
  const candidates = [...obstacles].filter(box =>
    moving.min.x < box.max.x - epsilon && moving.max.x > box.min.x + epsilon &&
    moving.min.z < box.max.z - epsilon && moving.max.z > box.min.z + epsilon,
  ).sort((a, b) => a.min.y - b.min.y);
  let lift = 0;
  for (const box of candidates) {
    if (moving.min.y + lift < box.max.y - epsilon && moving.max.y + lift > box.min.y + epsilon) {
      lift = box.max.y - moving.min.y;
    }
  }
  return lift;
}

export function stackedPosition(model: ImportedModel, id: string, position: Position3, candidateIds?: Iterable<string>): Position3 {
  const instance = stackingInstances(model).get(id);
  const boxes = stackingBounds(model), source = boxes.get(id);
  if (!instance || !source) return position;
  const moved = source.clone().translate(new Vector3(
    position.x - instance.matrix[3] / 20,
    position.y + instance.matrix[7] / 20,
    position.z - instance.matrix[11] / 20,
  ));
  const instances = stackingInstances(model);
  const candidates = [...(candidateIds ?? boxes.keys())].filter(otherId => otherId !== id)
    .map(otherId => ({ instance: instances.get(otherId), box: boxes.get(otherId) }))
    .filter((entry): entry is { instance: ImportedInstance; box: Box3 } => !!entry.instance && !!entry.box &&
      moved.min.x < entry.box.max.x - 0.0001 && moved.max.x > entry.box.min.x + 0.0001 &&
      moved.min.z < entry.box.max.z - 0.0001 && moved.max.z > entry.box.min.z + 0.0001)
    .sort((a, b) => a.box.min.y - b.box.min.y);
  let lift = 0;
  const proposed = [...instance.matrix] as Affine;
  proposed[3] = position.x * 20; proposed[11] = position.z * 20;
  const overlaps = importedCollisionQuery(model);
  for (let i = 0; i < candidates.length; i++) {
    const obstacle = candidates[i];
    if (moved.min.y + lift >= obstacle.box.max.y - 0.0001 || moved.max.y + lift <= obstacle.box.min.y + 0.0001) continue;
    proposed[7] = -(position.y + lift) * 20;
    // Only positive geometric clearance suppresses conservative lifting.
    if (overlaps(instance.reference, proposed, obstacle.instance.reference, obstacle.instance.matrix) !== "clear") {
      lift = obstacle.box.max.y - moved.min.y;
      // A lift can enter a previously clear cavity's roof or side wall.
      // Every lift passes at least one obstacle's top, so this terminates.
      i = -1;
    }
  }
  return { ...position, y: position.y + lift };
}

const modelInstances = new WeakMap<ImportedModel, Map<string, ImportedInstance>>();
function stackingInstances(model: ImportedModel): Map<string, ImportedInstance> {
  let instances = modelInstances.get(model);
  if (!instances) { instances = new Map(model.instances.map(instance => [instance.id, instance])); modelInstances.set(model, instances); }
  return instances;
}
