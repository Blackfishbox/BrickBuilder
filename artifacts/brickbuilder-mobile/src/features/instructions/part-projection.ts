import { Box3, OrthographicCamera, Vector3 } from "three";
import type { BuilderDocument } from "../editor/model";
import { compilePart } from "../engine/ldraw-geometry";
import { createLocalBrickGeometry } from "../engine/local-brick-geometry";
import type { InstructionPart } from "./parts";
import { PART_PREVIEW_DIRECTION } from "../parts/thumbnails/camera";

/** Normalized image bounds before the Studio PDF's optional horizontal mirror. */
export type ProjectedPartBounds = ReadonlyMap<string, readonly [number, number, number, number]>;

export function projectInstructionPartBounds(bounds: Map<string, Box3>, camera: OrthographicCamera): ProjectedPartBounds {
  const result = new Map<string, [number, number, number, number]>();
  for (const [id, box] of bounds) {
    if (box.isEmpty()) continue;
    const min = new Vector3(box.min.x, box.min.y, 0).applyMatrix4(camera.projectionMatrix);
    const max = new Vector3(box.max.x, box.max.y, 0).applyMatrix4(camera.projectionMatrix);
    result.set(id, [(min.x + 1) / 2, (1 - max.y) / 2, (max.x - min.x) / 2, (max.y - min.y) / 2]);
  }
  return result;
}

/** Project actual surfaces, not an overestimated axis-aligned box, in real mm. */
export function partProjectedSize(document: BuilderDocument, part: InstructionPart): [number, number] | undefined {
  const camera = new OrthographicCamera();
  camera.position.fromArray(PART_PREVIEW_DIRECTION); camera.lookAt(0, 0, 0); camera.updateMatrixWorld(true);
  const bounds = new Box3(), vertex = new Vector3();
  const include = (positions: ArrayLike<number>, scale: number, flipY: boolean) => {
    for (let offset = 0; offset < positions.length; offset += 3) {
      vertex.fromArray(positions, offset).multiplyScalar(scale);
      if (flipY) vertex.y *= -1;
      bounds.expandByPoint(vertex.applyMatrix4(camera.matrixWorldInverse));
    }
  };
  if (part.kind === "imported" && document.imported && part.part.part.status === "resolved") {
    for (const surface of compilePart(document.imported, part.part.reference, "16")) include(surface.positions, 0.4, true);
  } else if (part.kind === "legacy") {
    const geometry = createLocalBrickGeometry(part.part.type);
    try { include(geometry.getAttribute("position").array, 8, false); }
    finally { geometry.dispose(); }
  }
  if (bounds.isEmpty()) return undefined;
  const size = bounds.getSize(new Vector3());
  return [Math.max(0.01, size.x), Math.max(0.01, size.y)];
}
