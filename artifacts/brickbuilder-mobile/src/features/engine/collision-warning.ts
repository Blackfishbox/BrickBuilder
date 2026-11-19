import { BRICK_DEFINITIONS, BRICK_HEIGHT, type Brick } from "../editor/model";
import type { ImportedModel } from "../formats/types";
import { Box3, Euler, Matrix3, Matrix4, Vector3 } from "three";
import { OBB } from "three/examples/jsm/math/OBB.js";
import { importedCollisionQuery } from "./imported-collision";
import { stackingBounds } from "./stacking";

export interface CollisionWarnings {
  boxes: Map<string, Box3>;
  uncertain: boolean;
}

function warningVolume(brick: Brick) {
  const { studsX, studsZ } = BRICK_DEFINITIONS[brick.type];
  const { tiltX = 0, tiltZ = 0 } = brick as Brick & { tiltX?: number; tiltZ?: number };
  const rotation = new Matrix4().makeRotationFromEuler(new Euler(
    tiltX * Math.PI / 180, brick.rotation * Math.PI / 180, tiltZ * Math.PI / 180, "XYZ",
  ));
  const matrix = rotation.clone().setPosition(brick.x, brick.y, brick.z);
  const half = new Vector3(studsX / 2, BRICK_HEIGHT / 2, studsZ / 2);
  return {
    bounds: new Box3(half.clone().negate(), half.clone()).translate(new Vector3(0, BRICK_HEIGHT / 2, 0)).applyMatrix4(matrix),
    // Shrink only by contact tolerance, so rotated face contact is not penetration.
    solid: new OBB(new Vector3(0, BRICK_HEIGHT / 2, 0).applyMatrix4(matrix),
      half.clone().addScalar(-0.00001), new Matrix3().setFromMatrix4(rotation)),
  };
}

/** Broad-phase sweep with yielding and cancellation between narrow-phase queries.
 * Open LDraw meshes cannot prove penetration: report their bounds conservatively
 * as possible collisions, never as confirmed solid intersections.
 */
export async function collisionWarnings(
  bricks: Brick[], model: ImportedModel | undefined, signal: AbortSignal, importedOffset?: number,
): Promise<CollisionWarnings> {
  const importedBoxes = model ? stackingBounds(model) : new Map<string, Box3>();
  const total = new Box3();
  for (const box of importedBoxes.values()) total.union(box);
  const offset = model ? importedOffset ?? (total.isEmpty() ? 0 : Math.max(0, -total.min.y)) : 0;
  const volumes = new Map(bricks.map(brick => [brick.id, warningVolume(brick)]));
  // The overlay adds the imported display offset to all diagnostic boxes.
  // Express local bricks in the same source space, including in mixed builds.
  for (const volume of volumes.values()) {
    volume.bounds.translate(new Vector3(0, -offset, 0));
    volume.solid.center.y -= offset;
  }
  const entries = [...new Map([...importedBoxes, ...[...volumes].map(([id, volume]) => [id, volume.bounds] as const)])]
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
      const a = instances.get(id), b = instances.get(otherId);
      if (a && b && query) {
        const result = query(a.reference, a.matrix, b.reference, b.matrix);
        overlap = result !== "clear";
        if (overlap && result === "unknown") uncertain = true;
      } else if (volumes.has(id) && volumes.has(otherId)) {
        overlap = volumes.get(id)!.solid.intersectsOBB(volumes.get(otherId)!.solid);
      } else {
        overlap = true;
        uncertain = true;
      }
      if (overlap) { boxes.set(id, box); boxes.set(otherId, other); }
    }
  }
  return { boxes, uncertain };
}
