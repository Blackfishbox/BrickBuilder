import { projectedTriangle, visualCamera } from "../src/features/engine/svg-visual-fixtures";

/** Small public scene; coordinates and expected colors do not depend on lighting. */
export function svgCompatibilityFixture() {
  const width = 320, height = 240;
  const camera = visualCamera();
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  const triangle = (points: number[][], color: string, opacity = 1) =>
    projectedTriangle(camera, points.map(([x, y, z]) => [x / width * 2 - 1, 1 - y / height * 2, z]), color, opacity);
  const left = (z: number) => [[20, 20, z], [140, 20, z], [20, 110, z]];
  const right = (z: number) => [[180, 20, z], [300, 20, z], [180, 110, z]];
  // Deliberately submit near blue before far red/green: traversal order is wrong.
  const roots = [
    triangle(left(-0.4), "#0000ff", 0.5),
    triangle(left(0.4), "#ff0000"),
    triangle(right(-0.4), "#0000ff", 0.5),
    triangle(right(0.4), "#00ff00", 0.5),
    triangle([[-40, 150, 0], [140, 150, 0], [40, 270, 0]], "#ffff00"),
    triangle([[180, 150, 0], [300, 150, 0], [240, 230, -2]], "#00ffff"),
  ];
  return {
    roots, camera, width, height,
    dispose() {
      for (const mesh of roots) { mesh.geometry.dispose(); mesh.material.dispose(); }
    },
  };
}

// Interior samples avoid renderer-specific antialiasing along path boundaries.
export const svgCompatibilitySamples = [
  { name: "empty transparent background", x: 160, y: 120, rgba: [0, 0, 0, 0] },
  { name: "blue over opaque red", x: 40, y: 40, rgba: [128, 0, 128, 255] },
  { name: "blue over transparent green", x: 200, y: 40, rgba: [0, 85, 170, 191] },
  { name: "viewport-clipped yellow", x: 2, y: 165, rgba: [255, 255, 0, 255] },
  { name: "near-clipped cyan", x: 240, y: 165, rgba: [0, 255, 255, 255] },
  { name: "removed near-plane tip", x: 240, y: 210, rgba: [0, 0, 0, 0] },
] as const;
