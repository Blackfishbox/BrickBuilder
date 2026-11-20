import {
  InstancedMesh, Mesh,
  Object3D, PerspectiveCamera, Scene, SRGBColorSpace, WebGLRenderer,
} from "three";
import { createBuilderLighting } from "./lighting";
import { ViewExportError, type ViewExportOptions } from "./view-export-job";
export { ViewExportError, type ViewExportOptions, type ViewExportProgress } from "./view-export-job";

export type ViewFormat = "png" | "svg";
export type ViewExporter = (format: ViewFormat, options?: ViewExportOptions) => Promise<Uint8Array>;

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

/** A separate renderer never resizes, clears or mutates the interactive canvas. */
export async function renderView(
  roots: readonly Object3D[], currentCamera: PerspectiveCamera, format: ViewFormat,
  options: ViewExportOptions = {},
): Promise<Uint8Array> {
  if (options.signal?.aborted) throw new ViewExportError("cancelled");
  currentCamera.updateWorldMatrix(true, false);
  const camera = currentCamera.clone();
  // A clone has no parent; preserve world pose even when the source camera has one.
  currentCamera.matrixWorld.decompose(camera.position, camera.quaternion, camera.scale);
  camera.matrixAutoUpdate = false;
  camera.matrix.copy(currentCamera.matrixWorld);
  camera.updateMatrixWorld(true);
  const { width, height } = viewExportSize(camera.aspect);
  if (format === "svg") {
    const { renderSvgView } = await import("./svg-view-export");
    return renderSvgView(roots, camera, width, height, options);
  }
  if (!triangleCount(roots)) throw new ViewExportError("empty");
  const scene = new Scene();
  scene.add(createBuilderLighting());
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
