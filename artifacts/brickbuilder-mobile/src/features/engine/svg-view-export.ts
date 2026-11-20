import {
  BackSide, Box3, Color, DoubleSide, InstancedMesh, Matrix3, Matrix4, Mesh, Vector3, Vector4,
  type Material, type MeshLambertMaterial, type Object3D, type PerspectiveCamera,
} from "three";
import { exportJob, ViewExportError, type ViewExportOptions } from "./view-export-job";
import { SVG_LIMITS, SvgBytes, SvgFaces } from "./svg-export-buffer";
import { visibleOrder } from "./svg-visibility";
import { BUILDER_LIGHTING } from "./lighting";
import { surfaceStyle } from "./svg-surface-style";

// Clip in homogeneous coordinates before perspective division, including near plane.
type Vertex = { position: Vector4; shade: number };
type ScreenVertex = { x: number; y: number; z: number; shade: number };
type Tile = { left: number; top: number; right: number; bottom: number; depth: number; key: string };

class TileBudgetExceeded extends Error {}
class ProjectionWorkExceeded extends Error {}

function intersectsTile(
  bounds: Box3 | null, projection: Matrix4, width: number, height: number,
  tile: Tile, world: Matrix4, point: Vector3, clipPosition: Vector4,
): boolean {
  if (!bounds) return true;
  if (bounds.isEmpty()) return false;
  let left = Infinity, right = -Infinity, top = Infinity, bottom = -Infinity;
  for (let corner = 0; corner < 8; corner++) {
    point.set(
      corner & 1 ? bounds.max.x : bounds.min.x,
      corner & 2 ? bounds.max.y : bounds.min.y,
      corner & 4 ? bounds.max.z : bounds.min.z,
    );
    clipPosition.set(point.x, point.y, point.z, 1).applyMatrix4(world).applyMatrix4(projection);
    if (!Number.isFinite(clipPosition.w) || clipPosition.w <= 1e-8) return true;
    const x = clipPosition.x / clipPosition.w * width / 2;
    const y = -clipPosition.y / clipPosition.w * height / 2;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return true;
    left = Math.min(left, x); right = Math.max(right, x);
    top = Math.min(top, y); bottom = Math.max(bottom, y);
  }
  return right >= tile.left && left <= tile.right && bottom >= tile.top && top <= tile.bottom;
}

function clip(vertices: Vertex[]): Vertex[] {
  for (let plane = 0; plane < 6 && vertices.length; plane++) {
    const axis = Math.floor(plane / 2);
    const sign = plane % 2 === 0 ? 1 : -1;
    const distance = (v: Vertex) => v.position.w + sign * v.position.getComponent(axis);
    const result: Vertex[] = [];
    let previous = vertices[vertices.length - 1], before = distance(previous);
    for (const current of vertices) {
      const after = distance(current);
      if ((before < 0) !== (after < 0)) {
        const t = before / (before - after);
        result.push({ position: previous.position.clone().lerp(current.position, t),
          shade: previous.shade + t * (current.shade - previous.shade) });
      }
      if (after >= 0) result.push(current);
      previous = current; before = after;
    }
    vertices = result;
  }
  return vertices;
}

function* splitTile(tile: Tile): Generator<Tile> {
  const middleX = (tile.left + tile.right) / 2;
  const middleY = (tile.top + tile.bottom) / 2;
  const depth = tile.depth + 1;
  for (const [column, row] of [[0, 0], [1, 0], [0, 1], [1, 1]] as const) {
    const left = column ? middleX : tile.left;
    const right = column ? tile.right : middleX;
    const top = row ? middleY : tile.top;
    const bottom = row ? tile.bottom : middleY;
    if (right > left && bottom > top) {
      yield { left, right, top, bottom, depth, key: `${tile.key}${column}${row}` };
    }
  }
}

const sunDirection = new Vector3(...BUILDER_LIGHTING.direction).normalize();
const ground = new Color(BUILDER_LIGHTING.ground);

/** Flat Lambert shading with the same neutral hemisphere / sun as the builder. */
function irradiance(normal: Vector3): number {
  const skyWeight = (normal.y + 1) * 0.5;
  const hemi = ground.r * (1 - skyWeight) + skyWeight;
  return BUILDER_LIGHTING.hemisphere * hemi + BUILDER_LIGHTING.sun * Math.max(0, normal.dot(sunDirection));
}

/**
 * Progressive vector projection. Geometry stays shared; only bounded projected
 * faces are retained. No canvas/image fallback, even for very detailed models.
 * Visibility-aware BSP fragments remain vector geometry, not a raster depth buffer.
 */
async function renderSvgTile(
  roots: readonly Object3D[], camera: PerspectiveCamera, width: number, height: number,
  tile: Tile, checkpoint: ReturnType<typeof exportJob>, projectionWork: { count: number },
  boundsCache: WeakMap<Mesh["geometry"], Box3 | null>,
): Promise<Uint8Array> {
  try {
  const faces = new SvgFaces();
  const viewProjection = new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  const world = new Matrix4(), instance = new Matrix4(), projection = new Matrix4();
  const color = new Color(), instanceColor = new Color();
  const a = new Vector3(), b = new Vector3(), c = new Vector3();
  const normal = new Vector3(), edge = new Vector3();
  const boundPoint = new Vector3(), boundClip = new Vector4();
  const normalMatrix = new Matrix3();
  let processed = 0, batchProcessed = 0, visited = 0, surface = 0, hasSourceTriangles = false;

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
      let geometryBounds = boundsCache.get(geometry);
      if (geometryBounds === undefined) {
        // Only trust boxes already maintained by the geometry pipeline. A
        // fallback scan of every vertex here would block large exports.
        const computedBounds = geometry.boundingBox?.clone() ?? null;
        boundsCache.set(geometry, computedBounds);
        geometryBounds = computedBounds;
      }
      const safeBounds = geometryBounds ?? null;
      const indices = geometry.index;
      const colors = geometry.getAttribute("color");
      const normals = geometry.getAttribute("normal");
      const available = indices?.count ?? positions.count;
      const start = Math.max(0, geometry.drawRange.start);
      const end = Math.min(available, start + geometry.drawRange.count);
      const materials: Material[] = Array.isArray(object.material) ? object.material : [object.material];
      const groups = Array.isArray(object.material) ? geometry.groups : [{ start, count: end - start, materialIndex: 0 }];
      const count = object instanceof InstancedMesh ? object.count : 1;
      for (const group of groups) {
        const material = materials[group.materialIndex ?? 0] as MeshLambertMaterial | undefined;
        const from = Math.max(start, group.start), to = Math.min(end, group.start + group.count);
        if (material?.visible && material.opacity > 0 && to - from >= 3) hasSourceTriangles = true;
      }
      for (let number = 0; number < count; number++) {
        world.copy(object.matrixWorld);
        instanceColor.set(0xffffff);
        if (object instanceof InstancedMesh) {
          object.getMatrixAt(number, instance);
          world.multiply(instance);
          if (object.instanceColor) object.getColorAt(number, instanceColor);
        }
        projection.multiplyMatrices(viewProjection, world);
        if (!intersectsTile(safeBounds, projection, width, height, tile, world, boundPoint, boundClip)) {
          if (number % 128 === 0) await checkpoint({ phase: "project", completed: processed });
          continue;
        }
        normalMatrix.getNormalMatrix(world);
        const mirrored = world.determinant() < 0;
        surface++;
        for (const group of groups) {
          const material = materials[group.materialIndex ?? 0] as MeshLambertMaterial | undefined;
          if (!material?.visible || material.opacity <= 0) continue;
          const from = Math.max(start, group.start), to = Math.min(end, group.start + group.count);
          for (let index = from; index + 2 < to; index += 3) {
            processed++;
            batchProcessed++;
            if (++projectionWork.count > SVG_LIMITS.totalProjectionTriangles) throw new ProjectionWorkExceeded();
            if (processed % 128 === 0) await checkpoint({ phase: "project", completed: processed });
            // Source geometry is scanned in bounded batches; no source-triangle
            // list is retained between batches.
            if (batchProcessed >= SVG_LIMITS.inputTriangles) {
              batchProcessed = 0;
              await checkpoint({ phase: "project", completed: processed });
            }
            const ia = indices ? indices.getX(index) : index;
            const ib = indices ? indices.getX(index + 1) : index + 1;
            const ic = indices ? indices.getX(index + 2) : index + 2;
            a.fromBufferAttribute(positions, ia);
            b.fromBufferAttribute(positions, ib);
            c.fromBufferAttribute(positions, ic);
            const projected = [a, b, c].map(v => new Vector4(v.x, v.y, v.z, 1).applyMatrix4(projection));
            // Front-face orientation in WebGL is reversed for negative determinants.
            // Clip first, then test winding; normals are transformed independently.
            const polygon = clip(projected.map(position => ({ position, shade: 0 })));
            if (polygon.length < 3) continue;
            const screen = polygon.map(({ position: v }) => new Vector3(v.x / v.w * width / 2, -v.y / v.w * height / 2, v.z / v.w));
            if (!screen.every(v => Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z))) continue;
            const winding = (screen[1].x - screen[0].x) * (screen[2].y - screen[0].y) -
              (screen[1].y - screen[0].y) * (screen[2].x - screen[0].x);
            if (Math.abs(winding) < 1e-10) continue;
            const front = (winding < 0) !== mirrored;
            if (material.side !== DoubleSide && (material.side === BackSide ? front : !front)) continue;
            normal.subVectors(c, b).cross(edge.subVectors(a, b)).normalize();
            normal.applyNormalMatrix(normalMatrix);
            if (!front) normal.negate();
            color.copy(material.color ?? new Color(0xffffff)).multiply(instanceColor);
            if (material.vertexColors && colors) {
              color.multiply(new Color().setRGB(
                (colors.getX(ia) + colors.getX(ib) + colors.getX(ic)) / 3,
                (colors.getY(ia) + colors.getY(ib) + colors.getY(ic)) / 3,
                (colors.getZ(ia) + colors.getZ(ib) + colors.getZ(ic)) / 3,
              ));
            }
            const shades = [ia, ib, ic].map(id => {
              if (material.type === "MeshBasicMaterial") return 1;
              if (!material.flatShading && normals) {
                edge.fromBufferAttribute(normals, id).applyNormalMatrix(normalMatrix);
                if (!front) edge.negate();
                return irradiance(edge);
              }
              return irradiance(normal);
            });
            const shaded = clip(projected.map((position, k) => ({ position, shade: shades[k] })));
            const tilePolygon = shaded.map(({ position: v, shade }) => ({
              x: v.x / v.w * width / 2,
              y: -v.y / v.w * height / 2,
              z: v.z / v.w,
              shade,
            }));
            if (tilePolygon.length < 3) continue;
            const xs = tilePolygon.map(vertex => vertex.x), ys = tilePolygon.map(vertex => vertex.y);
            if (Math.max(...xs) < tile.left || Math.min(...xs) > tile.right ||
                Math.max(...ys) < tile.top || Math.min(...ys) > tile.bottom) continue;
            const rgb = color.getHex();
            const emission = material.emissive?.clone().multiplyScalar(material.emissiveIntensity ?? 1).getHex() ?? 0;
            for (let fan = 1; fan + 1 < tilePolygon.length; fan++) {
              const [p, q, r] = [tilePolygon[0], tilePolygon[fan], tilePolygon[fan + 1]];
              faces.add([p.x, p.y, q.x, q.y, r.x, r.y, (p.z + q.z + r.z) / 3, rgb, material.opacity,
                p.z, q.z, r.z, p.shade, q.shade, r.shade, surface, emission]);
            }
          }
        }
        // Many invisible, empty or out-of-range instances must remain interruptible too.
        if (number % 128 === 0) await checkpoint({ phase: "project", completed: processed });
      }
    }
  }
  if (!hasSourceTriangles) throw new ViewExportError("empty");
  const sorted = await faces.sorted((completed, total) => checkpoint({ phase: "sort", completed, total }));
  await checkpoint({ phase: "visibility", completed: 0 }, true);
  const order = await visibleOrder(faces, sorted, completed => checkpoint({ phase: "visibility", completed }));
  const bytes = new SvgBytes();
  // Reuse only identical projected vectors, never an affine approximation of a
  // perspective instance. References preserve painter order and alpha layering.
  const reused = new Map<string, string>();
  const idPrefix = tile.key ? `${tile.key}-` : "";
  let batch = "", batchKey = "", batchStyle = "";
  const flush = () => {
    if (batch) bytes.append(`<path d="${batch}"${batchStyle}/>`);
    batch = "";
  };
  for (let position = 0; position < order.length; position++) {
    if (position % 128 === 0) await checkpoint({ phase: "write", completed: position, total: order.length });
    const index = order[position];
    const n = (field: number) => Number(faces.get(index, field).toFixed(2));
    const d = `M${n(0)},${n(1)}L${n(2)},${n(3)}L${n(4)},${n(5)}Z`;
    // Shared coplanar panels paint once: no alpha accumulation or antialiased
    // diagonal cracks between triangles. Separate instances/layers stay separate.
    const { style, plane } = surfaceStyle(faces, index, bytes, idPrefix);
    const key = `${faces.get(index, 15)}:${plane}:${style}`;
    const next = position + 1 < order.length ? order[position + 1] : -1;
    const sameSurfaceNext = next >= 0 && faces.get(next, 15) === faces.get(index, 15);
    if (batch && (key !== batchKey || batch.length > 24 * 1024)) flush();
    if (batch || sameSurfaceNext) {
      batchKey = key; batchStyle = style; batch += d;
      continue;
    }
    flush();
    const reference = reused.get(d);
    if (reference) bytes.append(`<use href="#${reference}"${style}/>`);
    else if (reused.size < SVG_LIMITS.reuseEntries) {
      const id = `${idPrefix}f${reused.size}`;
      reused.set(d, id);
      bytes.append(`<defs><path id="${id}" d="${d}"/></defs><use href="#${id}"${style}/>`);
    } else bytes.append(`<path d="${d}"${style}/>`);
  }
  flush();
  const result = await bytes.finish(() => checkpoint({ phase: "write", completed: order.length, total: order.length }));
  await checkpoint({ phase: "write", completed: order.length, total: order.length }, true);
  return result;
  } catch (error) {
    if (error instanceof ProjectionWorkExceeded) throw new ViewExportError("complex");
    if (error instanceof ViewExportError && error.reason === "complex") throw new TileBudgetExceeded();
    throw error;
  }
}

function encode(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

/** Each leaf is independently clipped and painter-sorted, then merged as one SVG viewport. */
export async function* renderSvgView(
  roots: readonly Object3D[], camera: PerspectiveCamera, width: number, height: number,
  options: ViewExportOptions = {},
): AsyncGenerator<Uint8Array> {
  const checkpoint = exportJob(options);
  const projectionWork = { count: 0 };
  const boundsCache = new WeakMap<Mesh["geometry"], Box3 | null>();
  let tileCount = 1;
  let outputBytes = 0;
  const account = (chunk: Uint8Array) => {
    outputBytes += chunk.byteLength;
    if (outputBytes > SVG_LIMITS.totalOutputBytes) throw new ViewExportError("complex");
    return chunk;
  };
  const root: Tile = {
    left: -width / 2, top: -height / 2, right: width / 2, bottom: height / 2, depth: 0, key: "",
  };

  await checkpoint({ phase: "project", completed: 0 }, true);
  let rootContent: Uint8Array | null = null;
  try {
    rootContent = await renderSvgTile(roots, camera, width, height, root, checkpoint, projectionWork, boundsCache);
  } catch (error) {
    if (!(error instanceof TileBudgetExceeded)) throw error;
  }
  yield account(encode(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${root.left} ${root.top} ${width} ${height}" style="background-color:transparent">`));

  async function* visit(tile: Tile): AsyncGenerator<Uint8Array> {
    await checkpoint({ phase: "project", completed: projectionWork.count });
    try {
      const content = await renderSvgTile(roots, camera, width, height, tile, checkpoint, projectionWork, boundsCache);
      const tileWidth = tile.right - tile.left, tileHeight = tile.bottom - tile.top;
      yield account(encode(`<svg x="${tile.left}" y="${tile.top}" width="${tileWidth}" height="${tileHeight}" viewBox="${tile.left} ${tile.top} ${tileWidth} ${tileHeight}" overflow="hidden">`));
      yield account(content);
      yield account(encode("</svg>"));
    } catch (error) {
      if (!(error instanceof TileBudgetExceeded)) throw error;
      if (tile.depth >= SVG_LIMITS.maxTileDepth || tileCount + 3 > SVG_LIMITS.maxTiles ||
          tile.right - tile.left < 1 || tile.bottom - tile.top < 1) {
        throw new ViewExportError("complex");
      }
      tileCount += 3;
      for (const child of splitTile(tile)) yield* visit(child);
    }
  }

  if (rootContent) yield account(rootContent);
  else {
    if (tileCount + 3 > SVG_LIMITS.maxTiles) throw new ViewExportError("complex");
    tileCount += 3;
    for (const child of splitTile(root)) yield* visit(child);
  }
  yield account(encode("</svg>"));
}
