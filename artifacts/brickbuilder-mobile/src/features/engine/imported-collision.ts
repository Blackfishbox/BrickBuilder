import { Box3, Matrix4, Plane, Ray, Triangle, Vector3 } from "three";
import type { Affine, ImportedModel } from "../formats/types";
import { compilePart, worldMatrix, type Surface } from "./ldraw-geometry";

/** Unknown is deliberately distinct from geometric clearance. */
export type CollisionResult = "overlap" | "clear" | "unknown";
interface Face { triangle: Triangle; box: Box3 }
interface Node { box: Box3; children?: [Node, Node]; faces?: Face[] }
interface Shape { root: Node; faces: Face[]; closed: boolean }
interface Body { shape: Shape; matrix: Matrix4; inverse: Matrix4; boxes: Map<Node, Box3> }
const shapes = new WeakMap<Surface[], Shape | null>();
const EPS = 0.0001; // Studs; matches the automatic stacking contact tolerance.
const MAX_FACES = 20000, MAX_WORK = 100000;
const directions = [[0.37139, 0.55709, 0.74278], [-0.613, 0.217, 0.76], [0.433, -0.821, 0.372]]
  .map(v => new Vector3(...v).normalize());
class Budget {
  left = MAX_WORK;
  spend(amount = 1) { this.left -= amount; if (this.left < 0) throw new Error("Collision work budget exhausted"); }
}

function tree(faces: Face[]): Node {
  const box = new Box3();
  for (const face of faces) box.union(face.box);
  if (faces.length <= 8) return { box, faces };
  const size = box.getSize(new Vector3());
  const axis = size.x >= size.y && size.x >= size.z ? "x" : size.y >= size.z ? "y" : "z";
  faces.sort((a, b) => (a.box.min[axis] + a.box.max[axis]) - (b.box.min[axis] + b.box.max[axis]));
  const mid = Math.floor(faces.length / 2);
  return { box, children: [tree(faces.slice(0, mid)), tree(faces.slice(mid))] };
}

/** Shared with the renderer's compiled buffers, including across immutable edits.
 * Only watertight, two-manifold triangle soups may establish clearance. Open
 * meshes, non-manifold seams and excessive complexity retain conservative bounds.
 */
function shapeFor(model: ImportedModel, reference: string, budget: Budget): Shape | null {
  const surfaces = compilePart(model, reference, "16");
  if (shapes.has(surfaces)) return shapes.get(surfaces)!;
  const faceCount = surfaces.reduce((n, s) => n + s.positions.length / 9, 0);
  if (faceCount > MAX_FACES) {
    shapes.set(surfaces, null); return null;
  }
  // Cold preparation is part of the same per-placement budget too. A crowd
  // of previously unseen parts must not each receive a fresh build allowance.
  budget.spend(faceCount * 2);
  const faces: Face[] = [], edges = new Map<string, { count: number; face: number }>(), parents: number[] = [];
  const find = (value: number): number => {
    while (parents[value] !== value) { parents[value] = parents[parents[value]]; value = parents[value]; }
    return value;
  };
  const key = (v: Vector3) => v.toArray().map(n => Math.round(n * 1e7)).join(",");
  for (const surface of surfaces) for (let i = 0; i < surface.positions.length; i += 9) {
    // Keep a well-scaled local coordinate system; the instance carries the
    // original affine transform, including reflections and non-uniform scales.
    const vs = [0, 3, 6].map(offset => new Vector3().fromArray(surface.positions, i + offset).divideScalar(20));
    const triangle = new Triangle(vs[0], vs[1], vs[2]);
    if (triangle.getArea() < 1e-14) continue;
    const index = faces.length;
    parents.push(index);
    faces.push({ triangle, box: new Box3().setFromPoints(vs) });
    const keys = vs.map(key);
    for (let j = 0; j < 3; j++) {
      const edge = [keys[j], keys[(j + 1) % 3]].sort().join("|");
      const previous = edges.get(edge);
      if (previous) {
        previous.count++;
        parents[find(index)] = find(previous.face);
      } else edges.set(edge, { count: 1, face: index });
    }
  }
  let closed = [...edges.values()].every(edge => edge.count === 2);
  // LDraw parts often combine overlapping primitive shells. Global parity
  // would incorrectly subtract their intersection (XOR instead of union).
  // Accept independent shells only when their bounds are entirely disjoint.
  // Nested shells and touching/overlapping envelopes are unsupported rather
  // than silently interpreted as empty space. Connect by EDGES, not vertices:
  // shells touching at a single vertex must still receive this safeguard.
  const components = new Map<number, Box3>();
  for (let i = 0; i < faces.length; i++) {
    const root = find(i), box = components.get(root) ?? new Box3();
    box.union(faces[i].box); components.set(root, box);
  }
  const boxes = [...components.values()].sort((a, b) => a.min.x - b.min.x);
  for (let i = 0; closed && i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length && boxes[j].min.x <= boxes[i].max.x; j++) {
      budget.spend();
      if (boxes[i].intersectsBox(boxes[j])) { closed = false; break; }
    }
  }
  const shape = faces.length ? { root: tree([...faces]), faces, closed } : null;
  shapes.set(surfaces, shape); return shape;
}

function body(shape: Shape, affine: Affine): Body | null {
  const matrix = worldMatrix(affine).multiply(new Matrix4().makeScale(20, 20, 20));
  if (Math.abs(matrix.determinant()) < 1e-12) return null;
  return { shape, matrix, inverse: matrix.clone().invert(), boxes: new Map() };
}
function bounds(body: Body, node: Node): Box3 {
  let box = body.boxes.get(node);
  if (!box) { box = node.box.clone().applyMatrix4(body.matrix); body.boxes.set(node, box); }
  return box;
}
function worldFace(body: Body, face: Face): Triangle {
  return new Triangle(...[face.triangle.a, face.triangle.b, face.triangle.c]
    .map(v => v.clone().applyMatrix4(body.matrix)) as [Vector3, Vector3, Vector3]);
}

/** Strict interior, never counting a face/edge/vertex as solid penetration.
 * Ray hits on triangulation seams are retried rather than double-counted.
 */
function inside(point: Vector3, body: Body, budget: Budget): boolean {
  const p = point.clone().applyMatrix4(body.inverse);
  const tolerance = EPS * Math.max(...[0, 1, 2].map(i => new Vector3().setFromMatrixColumn(body.inverse, i).length()));
  for (const direction of directions) {
    const ray = new Ray(p, direction), hits: number[] = [], hit = new Vector3();
    let ambiguous = false;
    const visit = (node: Node) => {
      budget.spend();
      if (!ray.intersectsBox(node.box.clone().expandByScalar(tolerance))) return;
      if (node.children) { node.children.forEach(visit); return; }
      for (const { triangle } of node.faces!) {
        budget.spend();
        if (triangle.closestPointToPoint(p, hit).distanceTo(p) <= tolerance) { ambiguous = true; continue; }
        if (!ray.intersectTriangle(triangle.a, triangle.b, triangle.c, false, hit)) continue;
        const bary = triangle.getBarycoord(hit, new Vector3());
        if (!bary || Math.min(bary.x, bary.y, bary.z) < 1e-8) { ambiguous = true; continue; }
        hits.push(p.distanceTo(hit));
      }
    };
    visit(body.shape.root);
    // Boundary points are rejected by every direction. For an unlucky edge
    // hit use another ray; a genuinely ambiguous query falls back to bounds.
    if (!ambiguous) {
      hits.sort((a, b) => a - b);
      return hits.filter((v, i) => i === 0 || v - hits[i - 1] > tolerance).length % 2 === 1;
    }
    // Distinguish a boundary from an unlucky distant ray hit.
    const near = (node: Node): boolean => {
      budget.spend();
      if (node.box.distanceToPoint(p) > tolerance) return false;
      if (node.children) return node.children.some(near);
      return node.faces!.some(f => { budget.spend(); return f.triangle.closestPointToPoint(p, hit).distanceTo(p) <= tolerance; });
    };
    if (near(body.shape.root)) return false;
  }
  throw new Error("Ambiguous solid parity");
}

/** The common segment of non-coplanar triangles, or the centroid of their
 * coplanar overlap polygon. Testing both sides handles coincident solids while
 * rejecting face-only contact, independent of LDraw winding/BFC conventions.
 */
function intersection(a: Triangle, b: Triangle): Vector3 | null {
  const na = a.getNormal(new Vector3()), nb = b.getNormal(new Vector3());
  const pa = new Plane().setFromNormalAndCoplanarPoint(na, a.a);
  const pb = new Plane().setFromNormalAndCoplanarPoint(nb, b.a);
  const av = [a.a, a.b, a.c], bv = [b.a, b.b, b.c];
  if (new Vector3().crossVectors(na, nb).lengthSq() < 1e-14) {
    if (Math.abs(pb.distanceToPoint(a.a)) > EPS / 10) return null;
    let polygon = av.map(v => v.clone());
    for (let i = 0; i < 3 && polygon.length; i++) {
      const start = bv[i], end = bv[(i + 1) % 3];
      const inward = new Vector3().crossVectors(nb, end.clone().sub(start)).normalize();
      const output: Vector3[] = [];
      for (let j = 0; j < polygon.length; j++) {
        const p = polygon[j], q = polygon[(j + 1) % 3], d = inward.dot(p.clone().sub(start)), e = inward.dot(q.clone().sub(start));
        if (d >= 0) output.push(p);
        if ((d < 0) !== (e < 0)) output.push(p.clone().lerp(q, d / (d - e)));
      }
      polygon = output;
    }
    return polygon.length ? polygon.reduce((sum, v) => sum.add(v), new Vector3()).divideScalar(polygon.length) : null;
  }
  const slice = (vertices: Vector3[], plane: Plane): Vector3[] => {
    const points: Vector3[] = [];
    for (let i = 0; i < 3; i++) {
      const p = vertices[i], q = vertices[(i + 1) % 3], d = plane.distanceToPoint(p), e = plane.distanceToPoint(q);
      if (Math.abs(d) < 1e-9) points.push(p.clone());
      if (d * e < 0) points.push(p.clone().lerp(q, d / (d - e)));
    }
    return points;
  };
  const aa = slice(av, pb), bb = slice(bv, pa);
  if (!aa.length || !bb.length) return null;
  const axis = new Vector3().crossVectors(na, nb).normalize();
  const range = (vs: Vector3[]) => vs.map(v => v.dot(axis)).sort((x, y) => x - y);
  const ar = range(aa), br = range(bb), low = Math.max(ar[0], br[0]), high = Math.min(ar.at(-1)!, br.at(-1)!);
  if (high < low - 1e-9) return null;
  return aa[0].clone().addScaledVector(axis, (low + high) / 2 - aa[0].dot(axis));
}

function overlaps(a: Body, b: Body, budget: Budget): boolean {
  const commonInterior = (p: Vector3) => inside(p, a, budget) && inside(p, b, budget);
  const probes = (p: Vector3, normals: Vector3[]): boolean => {
    for (const n of normals) for (const sign of [-1, 1]) {
      if (n.lengthSq() <= 1e-16) continue;
      for (const distance of [EPS * 1.1, EPS * 4]) {
        if (commonInterior(p.clone().addScaledVector(n.clone().normalize(), distance * sign))) return true;
      }
    }
    return false;
  };
  const visit = (an: Node, bn: Node): boolean => {
    budget.spend();
    if (!bounds(a, an).intersectsBox(bounds(b, bn))) return false;
    if (an.children) return an.children.some(child => visit(child, bn));
    if (bn.children) return bn.children.some(child => visit(an, child));
    for (const af of an.faces!) for (const bf of bn.faces!) {
      budget.spend();
      if (!af.box.clone().applyMatrix4(a.matrix).intersectsBox(bf.box.clone().applyMatrix4(b.matrix))) continue;
      const at = worldFace(a, af), bt = worldFace(b, bf), p = intersection(at, bt);
      if (!p) continue;
      const na = at.getNormal(new Vector3()), nb = bt.getNormal(new Vector3());
      if (probes(p, [na, nb, na.clone().add(nb), na.clone().sub(nb)])) return true;
    }
    return false;
  };
  if (visit(a.shape.root, b.shape.root)) return true;
  // No surface crossing: test every disconnected component, not a fixed
  // sample of 32 faces that could miss a small fully enclosed solid.
  for (const [source, target] of [[a, b], [b, a]]) for (const face of source.shape.faces) {
    budget.spend();
    const t = worldFace(source, face), center = t.getMidpoint(new Vector3());
    if (inside(center, target, budget)) return true;
    if (probes(center, [t.getNormal(new Vector3())])) return true;
  }
  return false;
}

export function importedPartsOverlap(
  model: ImportedModel, movingReference: string, proposed: Affine, targetReference: string, target: Affine,
): CollisionResult {
  return importedCollisionQuery(model)(movingReference, proposed, targetReference, target);
}

/** One total traversal budget per placement, not one per neighbouring part. */
export function importedCollisionQuery(model: ImportedModel) {
  const budget = new Budget();
  return (movingReference: string, proposed: Affine, targetReference: string, target: Affine): CollisionResult => {
    try {
      budget.spend();
      const as = shapeFor(model, movingReference, budget), bs = shapeFor(model, targetReference, budget);
      if (!as || !bs || !as.closed || !bs.closed) return "unknown";
      const a = body(as, proposed), b = body(bs, target);
      if (!a || !b) return "unknown";
      if (!bounds(a, as.root).intersectsBox(bounds(b, bs.root))) return "clear";
      return overlaps(a, b, budget) ? "overlap" : "clear";
    } catch {
      return "unknown";
    }
  };
}
