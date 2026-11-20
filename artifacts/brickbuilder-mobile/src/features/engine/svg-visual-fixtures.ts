// Public, deterministic geometry only; no private imported models.
import {
  BoxGeometry, BufferGeometry, CylinderGeometry, DoubleSide, Float32BufferAttribute,
  Group, Mesh, MeshBasicMaterial, MeshLambertMaterial, PerspectiveCamera, SphereGeometry, Vector3,
} from "three";

export function visualCamera() {
  const camera = new PerspectiveCamera(42, 1, 0.1, 100);
  camera.position.z = 8; camera.updateMatrixWorld(true);
  return camera;
}

/** Vertices specified in NDC, so visibility expectations are camera independent. */
export function projectedTriangle(camera: PerspectiveCamera, points: number[][], color: string, opacity = 1) {
  const vertices = points.flatMap(p => new Vector3(...p as [number, number, number]).unproject(camera).toArray());
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(vertices, 3));
  return new Mesh(geometry, new MeshBasicMaterial({ color, side: DoubleSide, opacity, transparent: opacity < 1 }));
}

export function vehicleFixture() {
  const root = new Group();
  const red = new MeshLambertMaterial({ color: "#b02025" });
  const addBox = (size: [number, number, number], position: [number, number, number], material = red) => {
    const mesh = new Mesh(new BoxGeometry(...size), material);
    mesh.position.set(...position); root.add(mesh); return mesh;
  };
  addBox([4.6, 0.7, 1.8], [0, 0.2, 0]);
  addBox([2.5, 0.15, 1.8], [0.1, 1.65, 0]); // opaque roof
  const glass = new MeshLambertMaterial({ color: "#6fb9d0", transparent: true, opacity: 0.35, side: DoubleSide });
  addBox([2.45, 1.05, 0.015], [0.1, 1.1, 0.84], glass);
  addBox([2.45, 1.05, 0.015], [0.1, 1.1, -0.84], glass);
  addBox([1.8, 0.3, 1.25], [0.15, 0.85, 0], new MeshLambertMaterial({ color: "#282b30" }));
  const hood = addBox([1.4, 0.12, 1.8], [-1.55, 0.85, 0]);
  hood.rotation.z = 0.12;
  const curved = new Mesh(new SphereGeometry(0.48, 20, 12), red);
  curved.scale.set(1.2, 0.5, 1.8); curved.position.set(1.65, 0.65, 0); root.add(curved);
  for (const x of [-1.5, 1.5]) for (const z of [-0.95, 0.95]) {
    const wheel = new Mesh(new CylinderGeometry(0.5, 0.5, 0.26, 24),
      new MeshLambertMaterial({ color: "#25262a" }));
    wheel.rotation.x = Math.PI / 2; wheel.position.set(x, 0, z);
    if (z < 0) wheel.scale.x = -1;
    root.add(wheel);
  }
  const camera = new PerspectiveCamera(42, 1, 0.1, 100);
  camera.position.set(-6, 4.5, 7); camera.lookAt(0, 0.65, 0); camera.updateMatrixWorld(true);
  return { root, camera };
}
