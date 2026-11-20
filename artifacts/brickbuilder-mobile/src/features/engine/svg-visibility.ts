import { SvgFaces, SVG_LIMITS } from "./svg-export-buffer";
import { ViewExportError } from "./view-export-job";

// NDC z is affine in projected xy. A BSP in this space splits crossing faces
// exactly, unlike sorting their centres. It also orders translucent layers;
// opaque faces cover earlier fragments without discarding glass behind glass.
// No all-pairs intersection graph, recursion, raster mask or scene mutation.
type Plane = readonly [number, number, number, number];
const EPSILON = 1e-10;

function planeFor(f: SvgFaces, i: number): Plane {
  const x = f.get(i, 0), y = f.get(i, 1), z = f.get(i, 9);
  const ux = f.get(i, 2) - x, uy = f.get(i, 3) - y, uz = f.get(i, 10) - z;
  const vx = f.get(i, 4) - x, vy = f.get(i, 5) - y, vz = f.get(i, 11) - z;
  const a = (uz * vy - uy * vz) / (ux * vy - uy * vx);
  const b = (ux * vz - uz * vx) / (ux * vy - uy * vx);
  return [-a, -b, 1, a * x + b * y - z];
}

export async function visibleOrder(
  faces: SvgFaces, initial: Uint32Array,
  checkpoint: (completed: number) => Promise<void>,
): Promise<Uint32Array> {
  let operations = 0;
  const work = async () => {
    if (++operations > SVG_LIMITS.visibilityOperations) throw new ViewExportError("complex");
    if (operations % 2048 === 0) await checkpoint(operations);
  };
  const result = new Uint32Array(SVG_LIMITS.faces);
  let written = 0;
  // Entries in all pending lists together are bounded by the face/fragment cap.
  type Job = { ids: number[]; depth: number; emit?: boolean };
  const stack: Job[] = [{ ids: Array.from(initial), depth: 0 }];
  while (stack.length) {
    const { ids, depth, emit } = stack.pop()!;
    if (emit || ids.length < 2) {
      for (const id of ids) { result[written++] = id; await work(); }
      continue;
    }
    if (depth > SVG_LIMITS.visibilityDepth) throw new ViewExportError("complex");
    // Large opaque panels make good separating planes: splitting a roof by
    // dozens of tiny wheel facets creates unnecessary fragments and AA seams.
    // Keep the median-depth pivot on similarly sized layers to avoid skew.
    const median = ids[Math.floor(ids.length / 2)];
    const area = (id: number) => Math.abs(
      (faces.get(id, 2) - faces.get(id, 0)) * (faces.get(id, 5) - faces.get(id, 1)) -
      (faces.get(id, 3) - faces.get(id, 1)) * (faces.get(id, 4) - faces.get(id, 0))) *
      (faces.get(id, 8) === 1 ? 2 : 1);
    let pivot = median, best = area(median);
    for (let n = 0; n < 33; n++) {
      const id = ids[Math.floor(n * (ids.length - 1) / 32)], score = area(id);
      if (score > best * 1.3) { pivot = id; best = score; }
    }
    const candidate = planeFor(faces, pivot);
    let allCoplanar = true;
    for (const id of ids) {
      await work();
      if ([0, 1, 2].some(k => Math.abs(candidate[0] * faces.get(id, 2 * k) +
        candidate[1] * faces.get(id, 2 * k + 1) + faces.get(id, 9 + k) + candidate[3]) > EPSILON)) {
        allCoplanar = false; break;
      }
    }
    if (allCoplanar) {
      for (const id of ids) { result[written++] = id; await work(); }
      continue;
    }
    // First split disjoint screen regions when useful. This bounds work for
    // detailed planar meshes and avoids extending every small face across a car.
    let plane: Plane | undefined;
    if (ids.length > 4096) {
      for (let axis = 0; axis < 2 && !plane; axis++) {
        const sample = [];
        for (let n = 0; n < 17; n++) {
          const id = ids[Math.floor(n * (ids.length - 1) / 16)];
          sample.push((faces.get(id, axis) + faces.get(id, axis + 2) + faces.get(id, axis + 4)) / 3);
        }
        sample.sort((a, b) => a - b);
        const mid = sample[8];
        let low = 0, high = 0, crossing = 0;
        for (const id of ids) {
          const v = [0, 2, 4].map(k => faces.get(id, k + axis) - mid);
          if (Math.max(...v) <= 0) low++;
          else if (Math.min(...v) >= 0) high++;
          else crossing++;
          await work();
        }
        if (low > ids.length / 8 && high > ids.length / 8 && crossing < ids.length / 4)
          plane = axis === 0 ? [1, 0, 0, -mid] : [0, 1, 0, -mid];
      }
    }
    // The existing stable mean-depth sort is only a pivot heuristic now.
    plane ??= candidate;
    const [a, b, c, d] = plane;
    const far: number[] = [], near: number[] = [], same: number[] = [];
    for (const id of ids) {
      await work();
      const vertices = [0, 1, 2].map(k => [
        faces.get(id, k * 2), faces.get(id, k * 2 + 1),
        faces.get(id, 9 + k), faces.get(id, 12 + k),
      ]);
      const distances = vertices.map(v => a * v[0] + b * v[1] + c * v[2] + d);
      if (distances.every(v => Math.abs(v) <= EPSILON)) { same.push(id); continue; }
      if (distances.every(v => v >= -EPSILON)) { far.push(id); continue; }
      if (distances.every(v => v <= EPSILON)) { near.push(id); continue; }
      for (const sign of [1, -1]) {
        const polygon: number[][] = [];
        let previous = vertices[2], before = distances[2] * sign;
        for (let k = 0; k < 3; k++) {
          const current = vertices[k], after = distances[k] * sign;
          if ((before < 0) !== (after < 0)) {
            const t = before / (before - after);
            polygon.push(previous.map((v, j) => v + t * (current[j] - v)));
          }
          if (after >= 0) polygon.push(current);
          previous = current; before = after;
        }
        for (let k = 1; k + 1 < polygon.length; k++) {
          const [p, q, r] = [polygon[0], polygon[k], polygon[k + 1]];
          if (Math.abs((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0])) < 1e-10) continue;
          const next = faces.count;
          faces.add([p[0], p[1], q[0], q[1], r[0], r[1], (p[2] + q[2] + r[2]) / 3,
            faces.get(id, 7), faces.get(id, 8), p[2], q[2], r[2], p[3], q[3], r[3], faces.get(id, 15), faces.get(id, 16)]);
          (sign === 1 ? far : near).push(next);
        }
      }
    }
    // Coplanar source order remains stable. Split planes use positive z, so
    // positive halfspace is always farther away from the viewer.
    if (near.length) stack.push({ ids: near, depth: depth + 1 });
    if (same.length) stack.push({ ids: same, depth, emit: true });
    if (far.length) stack.push({ ids: far, depth: depth + 1 });
  }
  await checkpoint(operations);
  return result.subarray(0, written);
}
