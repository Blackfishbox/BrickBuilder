import {
  Color, Group, InstancedMesh, Material, Matrix4, Mesh, MeshLambertMaterial,
  Object3D, PerspectiveCamera, Scene, SRGBColorSpace, WebGLRenderer,
} from "three";
import { createBuilderLighting } from "./lighting";

export type ViewFormat = "png" | "svg";
export type ViewExporter = (format: ViewFormat) => Promise<Uint8Array>;
export class ViewExportError extends Error {
  constructor(public readonly reason: "unavailable" | "empty" | "complex" | "gpu") {
    super(reason);
  }
}

/** Preserve the entire viewport, including portrait framing, without camera refitting. */
export function viewExportSize(aspect: number): { width: number; height: number } {
  if (!Number.isFinite(aspect) || aspect <= 0) throw new ViewExportError("unavailable");
  return aspect >= 1
    ? { width: 3840, height: Math.max(1, Math.round(3840 / aspect)) }
    : { width: Math.max(1, Math.round(3840 * aspect)), height: 3840 };
}

export function triangleCount(roots: readonly Object3D[]): number {
  let count = 0;
  for (const root of roots) root.traverseVisible(object => {
    if (object instanceof Mesh) {
      const geometry = object.geometry;
      const available = geometry.index?.count ?? geometry.getAttribute("position")?.count ?? 0;
      count += Math.min(available, geometry.drawRange.count) / 3 *
        (object instanceof InstancedMesh ? object.count : 1);
    }
  });
  return count;
}

/** SVGRenderer does not support InstancedMesh: expand draws, sharing geometry only. */
export function vectorModel(roots: readonly Object3D[]): Group {
  if (triangleCount(roots) > 150_000) throw new ViewExportError("complex");
  const group = new Group();
  const matrix = new Matrix4();
  const color = new Color();
  for (const root of roots) {
    root.updateWorldMatrix(true, true);
    root.traverseVisible(object => {
      if (!(object instanceof Mesh)) return;
      const count = object instanceof InstancedMesh ? object.count : 1;
      for (let index = 0; index < count; index++) {
        const sourceMaterials: Material[] = Array.isArray(object.material) ? object.material : [object.material];
        const materials = sourceMaterials.map(source => {
          const original = source as MeshLambertMaterial;
          const material = new MeshLambertMaterial({
            color: original.color ?? 0xffffff, opacity: source.opacity,
            transparent: source.transparent, side: source.side, vertexColors: source.vertexColors,
          });
          if (object instanceof InstancedMesh && object.instanceColor) {
            object.getColorAt(index, color);
            material.color.multiply(color);
          }
          return material;
        });
        const mesh = new Mesh(object.geometry, Array.isArray(object.material) ? materials : materials[0]);
        mesh.matrixAutoUpdate = false;
        if (object instanceof InstancedMesh) {
          object.getMatrixAt(index, matrix);
          mesh.matrix.multiplyMatrices(object.matrixWorld, matrix);
        } else mesh.matrix.copy(object.matrixWorld);
        group.add(mesh);
      }
    });
  }
  return group;
}

/** A separate renderer never resizes, clears or mutates the interactive canvas. */
export async function renderView(
  roots: readonly Object3D[], currentCamera: PerspectiveCamera, format: ViewFormat,
): Promise<Uint8Array> {
  if (!triangleCount(roots)) throw new ViewExportError("empty");
  const camera = currentCamera.clone();
  camera.updateMatrixWorld(true);
  const { width, height } = viewExportSize(camera.aspect);
  const scene = new Scene();
  scene.add(createBuilderLighting());
  if (format === "svg") {
    const { SVGRenderer } = await import("three/addons/renderers/SVGRenderer.js");
    const model = vectorModel(roots);
    scene.add(model);
    try {
      const renderer = new SVGRenderer();
      renderer.setSize(width, height);
      renderer.setQuality("high");
      renderer.setClearColor(new Color(0x000000), 0);
      renderer.render(scene, camera);
      const svg = renderer.domElement;
      svg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
      svg.style.backgroundColor = "transparent";
      return new TextEncoder().encode(new XMLSerializer().serializeToString(svg));
    } finally {
      model.traverse(object => {
        if (object instanceof Mesh) {
          for (const material of Array.isArray(object.material) ? object.material : [object.material]) material.dispose();
        }
      });
    }
  }
  // Clone hierarchy/transforms, but retain shared, immutable GPU geometry and materials.
  for (const root of roots) scene.add(root.clone(true));
  let renderer: WebGLRenderer | undefined;
  try {
    renderer = new WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
    if (Math.max(width, height) > renderer.capabilities.maxTextureSize) throw new ViewExportError("gpu");
    renderer.outputColorSpace = SRGBColorSpace;
    renderer.setPixelRatio(1);
    renderer.setSize(width, height, false);
    renderer.setClearColor(0x000000, 0);
    renderer.render(scene, camera);
    const blob = await new Promise<Blob>((resolve, reject) => {
      renderer!.domElement.toBlob(result => result ? resolve(result) : reject(new ViewExportError("gpu")), "image/png");
    });
    return new Uint8Array(await blob.arrayBuffer());
  } finally {
    renderer?.dispose();
    renderer?.forceContextLoss();
    // Never dispose the shared model resources owned by BuilderCanvas.
  }
}
