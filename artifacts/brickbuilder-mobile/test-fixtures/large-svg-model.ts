import {
  BufferGeometry, DoubleSide, Float32BufferAttribute, Mesh, MeshBasicMaterial, PerspectiveCamera,
} from "three";

/** Distinct, visible coplanar faces; no downloaded parts or private model needed. */
export function largeSvgModel() {
  const triangles = 160_001;
  const positions = new Float32Array(triangles * 9);
  for (let index = 0; index < triangles; index++) {
    const x = (index % 401) / 200.5 - 1;
    const y = Math.floor(index / 401) / 200 - 1;
    positions.set([x, y, 0, x + 0.004, y, 0, x, y + 0.004, 0], index * 9);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  const material = new MeshBasicMaterial({ color: "#c4281c", side: DoubleSide });
  const model = new Mesh(geometry, material);
  const camera = new PerspectiveCamera(42, 9 / 16, 0.1, 100);
  camera.position.z = 8;
  camera.updateMatrixWorld(true);
  return { model, camera, triangles, dispose: () => { geometry.dispose(); material.dispose(); } };
}
