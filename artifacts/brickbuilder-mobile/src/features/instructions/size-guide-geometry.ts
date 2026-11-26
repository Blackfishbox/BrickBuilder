import type { BuilderDocument } from "../editor/model";
import { compilePart } from "../engine/ldraw-geometry";

export const normalizeSizeGuideReference = (reference: string) =>
  reference.replaceAll("\\", "/").split("/").pop()!.toLowerCase().replace(/\.dat$/, "");

export function sizeGuidePart(document: BuilderDocument, reference: string) {
  const number = normalizeSizeGuideReference(reference);
  return document.imported?.instances.find(part => normalizeSizeGuideReference(part.reference) === number);
}

export type SizeGuideProjection = {
  /** Orthographic source triangles in physical millimeters, never fitted. */
  triangles: number[][];
  width: number;
  height: number;
};

/** Local source axes, not the occurrence's placement or a thumbnail camera. */
export function sizeGuideProjection(document: BuilderDocument, reference: string): SizeGuideProjection | undefined {
  const part = sizeGuidePart(document, reference);
  if (!document.imported || part?.part.status !== "resolved") return;
  const surfaces = compilePart(document.imported, part.reference, "16");
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  let count = 0;
  for (const surface of surfaces) {
    count += surface.positions.length / 9;
    for (let offset = 0; offset < surface.positions.length; offset += 3) {
      for (let axis = 0; axis < 3; axis++) {
        const value = surface.positions[offset + axis];
        if (!Number.isFinite(value)) throw new Error("Invalid size-guide geometry");
        min[axis] = Math.min(min[axis], value);
        max[axis] = Math.max(max[axis], value);
      }
    }
  }
  // Do not sample a permanent measuring reference to meet a render budget.
  if (!count) return;
  if (count > 50_000) throw new Error("Size-guide geometry exceeds PDF budget");
  const size = max.map((value, axis) => value - min[axis]);
  const horizontal = size.indexOf(Math.max(...size));
  const transverse = [0, 1, 2].filter(axis => axis !== horizontal);
  const vertical = size[transverse[0]] >= size[transverse[1]] ? transverse[0] : transverse[1];
  const width = size[horizontal] * 0.4, height = size[vertical] * 0.4;
  if (!(width > 0 && height > 0)) return;
  const triangles: number[][] = [];
  for (const surface of surfaces) {
    for (let offset = 0; offset < surface.positions.length; offset += 9) {
      const triangle: number[] = [];
      for (let vertex = 0; vertex < 9; vertex += 3) {
        triangle.push((surface.positions[offset + vertex + horizontal] - min[horizontal]) * 0.4,
          (surface.positions[offset + vertex + vertical] - min[vertical]) * 0.4);
      }
      const [ax, ay, bx, by, cx, cy] = triangle;
      if (Math.abs((bx - ax) * (cy - ay) - (by - ay) * (cx - ax)) > 1e-10) triangles.push(triangle);
    }
  }
  if (!triangles.length) return;
  return { triangles, width, height };
}
