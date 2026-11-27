import {
  AmbientLight, Box3, DirectionalLight, Group, Mesh, OrthographicCamera, Scene, ShaderMaterial, Vector3, WebGLRenderer,
} from "three";
import { createImportedGroup, disposeImportedScene } from "../../engine/imported-scene";
import { setWideLineResolution } from "../../engine/wide-lines";
import type { ImportedModel } from "../../formats/types";
import { reuseGeometryCache } from "../../engine/ldraw-geometry";
import { THUMBNAIL_LIGHTING } from "../../engine/lighting";
import { PART_PREVIEW_DIRECTION } from "./camera";

let renderer: WebGLRenderer | undefined;
let idle: ReturnType<typeof setTimeout> | undefined;
let unavailableUntil = 0;
const DEFAULT_RENDER_SIZE = { width: 160, height: 120 };

function releaseRenderer() {
  renderer?.dispose();
  renderer?.forceContextLoss();
  renderer = undefined;
}

/** Keep screen-space part edges at the thumbnail's real pixel dimensions. */
export function configureThumbnailEdges(root: Group, width: number, height: number): void {
  root.traverse(object => {
    if (!(object instanceof Mesh) || !object.userData.isWideEdgeMesh ||
      !(object.material instanceof ShaderMaterial)) return;
    object.material.uniforms.lineWidth.value = 1;
    setWideLineResolution(object.material, width, height);
  });
}

/** A single detached canvas, never a WebGL context for each library row. */
export function renderThumbnail(
  model: ImportedModel, colorCode: string,
  configureEdges: (root: Group, width: number, height: number) => void = configureThumbnailEdges,
  size = DEFAULT_RENDER_SIZE,
): string {
  if (idle) clearTimeout(idle);
  if (Date.now() < unavailableUntil) throw new Error("3D-Vorschau derzeit nicht verfügbar.");
  try {
    if (!renderer) {
      renderer = new WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true, powerPreference: "low-power" });
      renderer.setPixelRatio(1);
      renderer.setClearColor(0xffffff, 0);
    }
    renderer.setSize(size.width, size.height);
    const colored = { ...model, instances: model.instances.map(instance => ({ ...instance, colorCode })) };
    reuseGeometryCache(model, colored);
    const group = createImportedGroup(colored);
    try {
      configureEdges(group, size.width, size.height);
      const bounds = new Box3().setFromObject(group);
      if (bounds.isEmpty()) throw new Error("Keine Vorschaugeometrie.");
      const center = bounds.getCenter(new Vector3());
      const modelSize = bounds.getSize(new Vector3());
      const radius = modelSize.length() / 2;
      if (!Number.isFinite(radius) || radius <= 0) throw new Error("Ungültige Vorschaugeometrie.");
      const camera = new OrthographicCamera(-radius * 1.48, radius * 1.48, radius * 1.11, -radius * 1.11, radius * 0.01, radius * 12);
      camera.position.copy(center).add(new Vector3(...PART_PREVIEW_DIRECTION).normalize().multiplyScalar(radius * 4));
      camera.lookAt(center);
      const scene = new Scene();
      scene.add(group, new AmbientLight(0xffffff, THUMBNAIL_LIGHTING.ambient));
      const light = new DirectionalLight(0xffffff, THUMBNAIL_LIGHTING.sun);
      light.position.copy(center).add(new Vector3(radius * 2, radius * 4, radius * 3));
      light.target.position.copy(center);
      scene.add(light, light.target);
      // LDraw's reflected Y axis and mixed BFC winding need illumination on
      // both sides of double-sided surfaces, otherwise studs look unshaded.
      const backLight = new DirectionalLight(0xffffff, THUMBNAIL_LIGHTING.sun);
      backLight.position.copy(center).add(new Vector3(-radius * 2, -radius * 4, -radius * 3));
      backLight.target.position.copy(center);
      scene.add(backLight, backLight.target);
      renderer.render(scene, camera);
      if (renderer.getContext().isContextLost()) throw new Error("3D-Vorschau unterbrochen.");
      return renderer.domElement.toDataURL("image/png");
    } finally { disposeImportedScene(group); }
  } catch (error) {
    releaseRenderer();
    unavailableUntil = Date.now() + 15_000;
    throw error;
  } finally {
    // Opening the library must not leave an extra GPU context alive indefinitely.
    idle = setTimeout(releaseRenderer, 30_000);
  }
}
