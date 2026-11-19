import type { Brick } from "../editor/model";
import type { ImportedModel } from "../formats/types";
import { Box3 } from "three";
import { brickVolume, brickVolumesOverlap } from "./brick-collision";
import { importedCollisionQuery } from "./imported-collision";
import { stackingBounds } from "./stacking";

export interface CollisionWarnings {
  boxes: Map<string, Box3>;
  uncertain: boolean;
}

/** Broad-phase sweep with yielding and cancellation between narrow-phase queries.
 * Open LDraw meshes cannot prove penetration: report their bounds conservatively
 * as possible collisions, never as confirmed solid intersections.
 */
export async function collisionWarnings(
  bricks: Brick[], model: ImportedModel | undefined, signal: AbortSignal,
): Promise<CollisionWarnings> {
  const volumes = new Map(bricks.map(brick => [brick.id, brickVolume(brick)]));
  const entries = [...(model ? stackingBounds(model) : new Map([...volumes].map(([id, volume]) => [id, volume.bounds])))]
    .filter(([, box]) => !box.isEmpty()).sort((a, b) => a[1].min.x - b[1].min.x);
  const instances = new Map(model?.instances.map(instance => [instance.id, instance]));
  const query = model ? importedCollisionQuery(model) : null;
  const boxes = new Map<string, Box3>();
  let uncertain = false, sliceStart = performance.now(), work = 0;
  const checkpoint = async () => {
    if (signal.aborted) throw new DOMException("Aborted", "AbortError");
    if (++work % 32 === 0 || performance.now() - sliceStart > 8) {
      await new Promise(resolve => setTimeout(resolve, 0));
      sliceStart = performance.now();
      if (signal.aborted) throw new DOMException("Aborted", "AbortError");
    }
  };
  for (let i = 0; i < entries.length; i++) {
    await checkpoint();
    const [id, box] = entries[i];
    for (let j = i + 1; j < entries.length && entries[j][1].min.x < box.max.x - 0.0001; j++) {
      await checkpoint();
      const [otherId, other] = entries[j];
      if (box.min.y >= other.max.y - 0.0001 || other.min.y >= box.max.y - 0.0001 ||
          box.min.z >= other.max.z - 0.0001 || other.min.z >= box.max.z - 0.0001) continue;
      let overlap: boolean;
      if (model && query) {
        const a = instances.get(id)!, b = instances.get(otherId)!;
        const result = query(a.reference, a.matrix, b.reference, b.matrix);
        overlap = result !== "clear";
        if (overlap && result === "unknown") uncertain = true;
      } else overlap = brickVolumesOverlap(volumes.get(id)!, volumes.get(otherId)!);
      if (overlap) { boxes.set(id, box); boxes.set(otherId, other); }
    }
  }
  return { boxes, uncertain };
}
