import { CylinderGeometry } from "three";
import { describe, expect, it } from "vitest";
import { visibleEdgeData } from "./ldraw-geometry";

describe("derived LDraw edge smoothing", () => {
  it("removes 16-sided stud facet seams while keeping the top and bottom rims", () => {
    const cylinder = new CylinderGeometry(0.27, 0.27, 0.16, 16);
    const flat = cylinder.toNonIndexed();
    try {
      const edges = visibleEdgeData([{
        colorCode: "16",
        positions: flat.getAttribute("position").array as Float32Array,
        normals: flat.getAttribute("normal").array as Float32Array,
        edges: new Float32Array(),
      }]);
      expect(edges.positions.length / 6).toBe(32);

      for (let offset = 0; offset < edges.positions.length; offset += 6) {
        const dx = Math.abs(edges.positions[offset] - edges.positions[offset + 3]);
        const dz = Math.abs(edges.positions[offset + 2] - edges.positions[offset + 5]);
        expect(dx + dz).toBeGreaterThan(0.01);
      }
    } finally {
      flat.dispose();
      cylinder.dispose();
    }
  });
});
