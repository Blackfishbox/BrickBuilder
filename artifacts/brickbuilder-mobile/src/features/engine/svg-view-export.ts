import {
  BackSide, Color, DoubleSide, InstancedMesh, Matrix4, Mesh, Vector3, Vector4,
  type Material, type MeshLambertMaterial, type Object3D, type PerspectiveCamera,
} from "three";
import { exportJob, ViewExportError, type ViewExportOptions } from "./view-export-job";
import { SVG_LIMITS, SvgBytes, SvgFaces } from "./svg-export-buffer";

// Clip in homogeneous coordinates before perspective division, including near plane.
function clip(vertices: Vector4[]): Vector4[] {
  for (let plane = 0; plane < 6 && vertices.length; plane++) {
    const axis = Math.floor(plane / 2);
    const sign = plane % 2 === 0 ? 1 : -1;
    const distance = (v: Vector4) => v.w + sign * v.getComponent(axis);
    const result: Vector4[] = [];
    let previous = vertices[vertices.length - 1], before = distance(previous);
    for (const current of vertices) {
      const after = distance(current);
      if ((before < 0) !== (after < 0)) {
        result.push(previous.clone().lerp(current, before / (before - after)));
      }
      if (after >= 0) result.push(current);
      previous = current; before = after;
    }
    vertices = result;
  }
  return vertices;
}

const sunDirection = new Vector3(-8, 18, 11).normalize();
const ground = new Color(0x808080);

/** Flat Lambert shading with the same neutral hemisphere / sun as the builder. */
function faceColor(base: Color, normal: Vector3): number {
  const skyWeight = (normal.y + 1) * 0.5;
  const hemi = ground.r * (1 - skyWeight) + skyWeight;
  const irradiance = 0.65 * hemi + 0.35 * Math.max(0, normal.dot(sunDirection));
  return base.clone().multiplyScalar(irradiance).getHex();
}

/**
 * Progressive vector projection. Geometry stays shared; only bounded projected
 * faces are retained. No canvas/image fallback, even for very detailed models.
 * Like SVGRenderer this uses painter ordering, not a raster depth buffer.
 */
export async function renderSvgView(
  roots: readonly Object3D[], camera: PerspectiveCamera, width: number, height: number,
  options: ViewExportOptions = {},
): Promise<Uint8Array> {
  const checkpoint = exportJob(options);
  await checkpoint({ phase: "project", completed: 0 }, true);
  const faces = new SvgFaces();
  const viewProjection = new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  const world = new Matrix4(), instance = new Matrix4(), projection = new Matrix4();
  const color = new Color(), instanceColor = new Color();
  const a = new Vector3(), b = new Vector3(), c = new Vector3();
  const normal = new Vector3(), edge = new Vector3();
  let processed = 0, visited = 0;

  // A stack of child iterators avoids copying an arbitrarily wide scene's children.
  function* visible(objects: readonly Object3D[]): Generator<Object3D> {
    const stack = [objects[Symbol.iterator]()];
    while (stack.length) {
      const next = stack[stack.length - 1].next();
      if (next.done) { stack.pop(); continue; }
      const object = next.value;
      if (!object.visible) continue;
      yield object;
      stack.push(object.children[Symbol.iterator]());
    }
  }

  for (const root of roots) {
    root.updateWorldMatrix(true, false);
    for (const object of visible([root])) {
      object.updateWorldMatrix(false, false);
      if (++visited % 128 === 0) await checkpoint({ phase: "project", completed: processed });
      if (!(object instanceof Mesh)) continue;
      const geometry = object.geometry;
      const positions = geometry.getAttribute("position");
      if (!positions) continue;
      const indices = geometry.index;
      const colors = geometry.getAttribute("color");
      const available = indices?.count ?? positions.count;
      const start = Math.max(0, geometry.drawRange.start);
      const end = Math.min(available, start + geometry.drawRange.count);
      const materials: Material[] = Array.isArray(object.material) ? object.material : [object.material];
      const groups = Array.isArray(object.material) ? geometry.groups : [{ start, count: end - start, materialIndex: 0 }];
      const count = object instanceof InstancedMesh ? object.count : 1;
      for (let number = 0; number < count; number++) {
        world.copy(object.matrixWorld);
        instanceColor.set(0xffffff);
        if (object instanceof InstancedMesh) {
          object.getMatrixAt(number, instance);
          world.multiply(instance);
          if (object.instanceColor) object.getColorAt(number, instanceColor);
        }
        projection.multiplyMatrices(viewProjection, world);
        for (const group of groups) {
          const material = materials[group.materialIndex ?? 0] as MeshLambertMaterial | undefined;
          if (!material?.visible || material.opacity <= 0) continue;
          const from = Math.max(start, group.start), to = Math.min(end, group.start + group.count);
          for (let index = from; index + 2 < to; index += 3) {
            if (++processed > SVG_LIMITS.inputTriangles) throw new ViewExportError("complex");
            if (processed % 128 === 0) await checkpoint({ phase: "project", completed: processed });
            const ia = indices ? indices.getX(index) : index;
            const ib = indices ? indices.getX(index + 1) : index + 1;
            const ic = indices ? indices.getX(index + 2) : index + 2;
            a.fromBufferAttribute(positions, ia);
            b.fromBufferAttribute(positions, ib);
            c.fromBufferAttribute(positions, ic);
            const polygon = clip([a, b, c].map(v => new Vector4(v.x, v.y, v.z, 1).applyMatrix4(projection)));
            if (polygon.length < 3) continue;
            const screen = polygon.map(v => new Vector3(v.x / v.w * width / 2, -v.y / v.w * height / 2, v.z / v.w));
            if (!screen.every(v => Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z))) continue;
            const winding = (screen[1].x - screen[0].x) * (screen[2].y - screen[0].y) -
              (screen[1].y - screen[0].y) * (screen[2].x - screen[0].x);
            if (Math.abs(winding) < 1e-10) continue;
            const front = winding < 0;
            if (material.side !== DoubleSide && (material.side === BackSide ? front : !front)) continue;
            a.applyMatrix4(world); b.applyMatrix4(world); c.applyMatrix4(world);
            normal.subVectors(c, b).cross(edge.subVectors(a, b)).normalize();
            if (!front) normal.negate();
            color.copy(material.color ?? new Color(0xffffff)).multiply(instanceColor);
            if (material.vertexColors && colors) {
              color.multiply(new Color().setRGB(
                (colors.getX(ia) + colors.getX(ib) + colors.getX(ic)) / 3,
                (colors.getY(ia) + colors.getY(ib) + colors.getY(ic)) / 3,
                (colors.getZ(ia) + colors.getZ(ib) + colors.getZ(ic)) / 3,
              ));
            }
            const rgb = faceColor(color, normal);
            for (let fan = 1; fan + 1 < screen.length; fan++) {
              const [p, q, r] = [screen[0], screen[fan], screen[fan + 1]];
              faces.add([p.x, p.y, q.x, q.y, r.x, r.y, (p.z + q.z + r.z) / 3, rgb, material.opacity]);
            }
          }
        }
        // Many invisible, empty or out-of-range instances must remain interruptible too.
        if (number % 128 === 0) await checkpoint({ phase: "project", completed: processed });
      }
    }
  }
  if (!processed) throw new ViewExportError("empty");
  const order = await faces.sorted((completed, total) => checkpoint({ phase: "sort", completed, total }));
  const bytes = new SvgBytes();
  bytes.append(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${-width / 2} ${-height / 2} ${width} ${height}" style="background-color:transparent">`);
  // Reuse only identical projected vectors, never an affine approximation of a
  // perspective instance. References preserve painter order and alpha layering.
  const reused = new Map<string, string>();
  for (let position = 0; position < order.length; position++) {
    if (position % 128 === 0) await checkpoint({ phase: "write", completed: position, total: order.length });
    const index = order[position];
    const n = (field: number) => Number(faces.get(index, field).toFixed(2));
    const d = `M${n(0)},${n(1)}L${n(2)},${n(3)}L${n(4)},${n(5)}Z`;
    const fill = `#${faces.get(index, 7).toString(16).padStart(6, "0")}`;
    const alpha = Number(faces.get(index, 8).toFixed(4));
    const style = ` fill="${fill}"${alpha < 1 ? ` fill-opacity="${alpha}"` : ""}`;
    const reference = reused.get(d);
    if (reference) bytes.append(`<use href="#${reference}"${style}/>`);
    else if (reused.size < SVG_LIMITS.reuseEntries) {
      const id = `f${reused.size}`;
      reused.set(d, id);
      bytes.append(`<defs><path id="${id}" d="${d}"/></defs><use href="#${id}"${style}/>`);
    } else bytes.append(`<path d="${d}"${style}/>`);
  }
  bytes.append("</svg>");
  const result = await bytes.finish(() => checkpoint({ phase: "write", completed: order.length, total: order.length }));
  await checkpoint({ phase: "write", completed: order.length, total: order.length }, true);
  return result;
}
