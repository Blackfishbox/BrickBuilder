import {
  Box3, Color, InstancedBufferAttribute, InstancedBufferGeometry, Mesh, SRGBColorSpace, type BufferGeometry,
} from "three";
import type { Brick } from "../editor/model";
import { brickTransformMatrix } from "../editor/brick-transform";
import { localBrickEdgeNormalPairs, localBrickEdges } from "./local-brick-geometry";
import { expandWideLines, wideLineMaterial } from "./wide-lines";
import { expandLegacyLines, legacyLineMaterial } from "./legacy-lines";

/** Build one GPU edge batch per local brick shape, preserving per-part transforms and colors. */
export function createLocalBrickEdgeBatches(bricks: readonly Brick[], legacy = false): Mesh[] {
  const groups = new Map<Brick["type"], Brick[]>();
  for (const brick of bricks) {
    const group = groups.get(brick.type) ?? [];
    group.push(brick);
    groups.set(brick.type, group);
  }

  const batches: Mesh[] = [];
  for (const [type, parts] of groups) {
    const normals = legacy ? undefined : localBrickEdgeNormalPairs(type);
    const source = localBrickEdges(type);
    const expanded = legacy ? expandLegacyLines(source) : expandWideLines(source, normals?.primary, normals?.alternate);
    const geometry = new InstancedBufferGeometry();
    for (const [name, attribute] of Object.entries(expanded.attributes)) geometry.setAttribute(name, attribute);
    expanded.dispose();

    const rows = [
      new Float32Array(parts.length * 4),
      new Float32Array(parts.length * 4),
      new Float32Array(parts.length * 4),
    ];
    const bounds = new Box3(), transformed = new Box3();
    geometry.computeBoundingBox();
    const local = geometry.boundingBox!.clone();
    const colors = legacy ? undefined : new Uint8Array(parts.length * 3);
    parts.forEach((brick, index) => {
      const matrix = brickTransformMatrix(brick), elements = matrix.elements;
      for (let row = 0; row < 3; row++) {
        rows[row].set([elements[row], elements[4 + row], elements[8 + row], elements[12 + row]], index * 4);
      }
      bounds.union(transformed.copy(local).applyMatrix4(matrix));
      if (colors) {
        const encoded = new Color(brick.color).getHex(SRGBColorSpace);
        colors.set([(encoded >> 16) & 0xff, (encoded >> 8) & 0xff, encoded & 0xff], index * 3);
      }
    });

    rows.forEach((row, index) => geometry.setAttribute(`instanceRow${index}`, new InstancedBufferAttribute(row, 4)));
    if (colors) geometry.setAttribute("instanceEdgeColor", new InstancedBufferAttribute(colors, 3, true));
    geometry.setAttribute("instructionFocus", new InstancedBufferAttribute(new Float32Array(parts.length), 1));
    geometry.instanceCount = parts.length;
    geometry.boundingBox = bounds;
    geometry.computeBoundingSphere();

    const mesh = new Mesh(geometry as BufferGeometry, legacy ? legacyLineMaterial() : wideLineMaterial());
    mesh.name = `brick-edges-${type}`;
    mesh.userData.brickIds = parts.map(brick => brick.id);
    mesh.userData.isWideEdgeMesh = true;
    mesh.userData.legacyEdges = legacy;
    mesh.frustumCulled = false;
    if (!legacy) mesh.renderOrder = 10;
    batches.push(mesh);
  }
  return batches;
}
