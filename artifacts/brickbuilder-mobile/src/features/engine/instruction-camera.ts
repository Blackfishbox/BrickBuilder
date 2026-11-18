import { Euler, PerspectiveCamera, Quaternion, Vector3 } from "three";

/** Inverse camera rotation gives the same model view as the PDF's XYZ pivot. */
export function applyInstructionCameraRotation(
  camera: PerspectiveCamera,
  target: Vector3,
  rotation?: readonly [number, number, number],
): void {
  camera.up.set(0, 1, 0);
  if (rotation) {
    const radians = rotation.map(angle => (angle % 360) * Math.PI / 180) as [number, number, number];
    const inverse = new Quaternion().setFromEuler(new Euler(...radians, "XYZ")).invert();
    camera.position.sub(target).applyQuaternion(inverse).add(target);
    camera.up.applyQuaternion(inverse);
  }
  camera.lookAt(target);
  camera.updateMatrixWorld(true);
}
