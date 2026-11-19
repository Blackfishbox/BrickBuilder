import { OrthographicCamera, Vector3 } from "three";
import type { InstructionCamera } from "./types";

/** Shared PDF camera, with the touch view's angle, relative zoom and pan. */
export function applyPdfStepCamera(camera: OrthographicCamera, radius: number, saved?: InstructionCamera): void {
  const target = new Vector3();
  camera.up.set(0, 1, 0);
  if (saved) {
    const distance = radius * 4;
    const panScale = distance / saved.referenceDistance;
    target.fromArray(saved.target).sub(new Vector3(...saved.referenceTarget)).multiplyScalar(panScale);
    camera.position.set(Math.sin(saved.phi) * Math.sin(saved.theta), Math.cos(saved.phi),
      Math.sin(saved.phi) * Math.cos(saved.theta)).multiplyScalar(distance).add(target);
    camera.zoom = saved.referenceDistance / saved.distance;
  } else {
    camera.position.set(1.1, 0.85, 1.3).normalize().multiplyScalar(radius * 4);
    camera.zoom = 1;
  }
  camera.lookAt(target); camera.updateMatrixWorld(true); camera.updateProjectionMatrix();
}
