import {
  AmbientLight, Box3, DirectionalLight, OrthographicCamera, Scene, Vector3, WebGLRenderer,
} from "three";
import { createImportedGroup, disposeImportedScene } from "../../engine/imported-scene";
import type { ImportedModel } from "../../formats/types";
import { reuseGeometryCache } from "../../engine/ldraw-geometry";

let renderer: WebGLRenderer | undefined;
let idle: ReturnType<typeof setTimeout> | undefined;
let unavailableUntil = 0;

function releaseRenderer() {
  renderer?.dispose();
  renderer?.forceContextLoss();
  renderer = undefined;
}

/** A single detached canvas, never a WebGL context for each library row. */
export function renderThumbnail(model: ImportedModel, colorCode: string): string {
  if (idle) clearTimeout(idle);
  if (Date.now() < unavailableUntil) throw new Error("3D-Vorschau derzeit nicht verfügbar.");
  try {
    if (!renderer) {
      renderer = new WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true, powerPreference: "low-power" });
      renderer.setPixelRatio(1);
      renderer.setSize(160, 120);
      renderer.setClearColor(0xffffff, 0);
    }
    const colored = { ...model, instances: model.instances.map(instance => ({ ...instance, colorCode })) };
    reuseGeometryCache(model, colored);
    const group = createImportedGroup(colored);
    try {
      const bounds = new Box3().setFromObject(group);
      if (bounds.isEmpty()) throw new Error("Keine Vorschaugeometrie.");
      const center = bounds.getCenter(new Vector3());
      const size = bounds.getSize(new Vector3());
      const radius = size.length() / 2;
      if (!Number.isFinite(radius) || radius <= 0) throw new Error("Ungültige Vorschaugeometrie.");
      const camera = new OrthographicCamera(-radius * 1.48, radius * 1.48, radius * 1.11, -radius * 1.11, radius * 0.01, radius * 12);
      camera.position.copy(center).add(new Vector3(1.4, 1.05, 1.6).normalize().multiplyScalar(radius * 4));
      camera.lookAt(center);
      const scene = new Scene();
      scene.add(group, new AmbientLight(0xffffff, 0.5));
      const light = new DirectionalLight(0xffffff, 1.2);
      light.position.copy(center).add(new Vector3(radius * 2, radius * 4, radius * 3));
      light.target.position.copy(center);
      scene.add(light, light.target);
      // LDraw's reflected Y axis and mixed BFC winding need illumination on
      // both sides of double-sided surfaces, otherwise studs look unshaded.
      const backLight = new DirectionalLight(0xffffff, 1.2);
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
