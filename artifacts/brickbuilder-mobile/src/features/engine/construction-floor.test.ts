import { Box3, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { brickConstructionBounds, CONSTRUCTION_FLOOR_MARGIN, constructionArea, createStudGridGeometry, MAX_STUD_GRID_LINES } from "./construction-floor";

describe("dynamic construction floor", () => {
  it("keeps the familiar empty floor and adds a margin around negative coordinates", () => {
    expect(constructionArea(new Box3())).toMatchObject({
      minX: -17, maxX: 17, minZ: -17, maxZ: 17, width: 34, depth: 34,
    });
    const bounds = new Box3(new Vector3(-42.2, 0, -12.1), new Vector3(-20.3, 5, 13.2));
    const area = constructionArea(bounds);
    expect(area.minX).toBeLessThanOrEqual(bounds.min.x - CONSTRUCTION_FLOOR_MARGIN);
    expect(area.maxX).toBeGreaterThanOrEqual(bounds.max.x + CONSTRUCTION_FLOOR_MARGIN);
    expect(area.minZ).toBeLessThanOrEqual(bounds.min.z - CONSTRUCTION_FLOOR_MARGIN);
    expect(area.maxZ).toBeGreaterThanOrEqual(bounds.max.z + CONSTRUCTION_FLOOR_MARGIN);
    expect(area.centerX).toBeLessThan(0);
  });

  it("covers a far-offset import with a bounded stud-aligned grid", () => {
    const bounds = new Box3(new Vector3(12_340, -20, -8_000), new Vector3(15_000, 300, -7_900));
    const area = constructionArea(bounds);
    const geometry = createStudGridGeometry(area);
    const position = geometry.getAttribute("position");
    const vertices = Array.from(position.array);
    expect(area.gridStride).toBeGreaterThan(1);
    expect(position.count).toBeLessThanOrEqual(MAX_STUD_GRID_LINES * 4);
    expect(vertices.length % 6).toBe(0);
    expect(vertices.every(Number.isFinite)).toBe(true);
    expect(vertices.some(value => value < 0)).toBe(true);
    expect(area.minX).toBeLessThan(bounds.min.x);
    expect(area.maxX).toBeGreaterThan(bounds.max.x);
    expect(area.minZ).toBeLessThan(bounds.min.z);
    expect(area.maxZ).toBeGreaterThan(bounds.max.z);
    for (let index = 0; index < vertices.length; index += 3) {
      const coordinate = vertices[index]!;
      if (coordinate !== area.minX && coordinate !== area.maxX) {
        expect(coordinate / area.gridStride).toBeCloseTo(Math.round(coordinate / area.gridStride));
      }
    }
    geometry.dispose();
  });

  it("uses rotated brick bounds instead of its unrotated footprint", () => {
    const bounds = brickConstructionBounds({
      id: "offset", type: "brick-2x4", color: "#b40000",
      x: -25, y: 2, z: 40, rotation: 90,
    });
    expect(bounds.min.x).toBeCloseTo(-27);
    expect(bounds.max.x).toBeCloseTo(-23);
    expect(bounds.min.z).toBeCloseTo(39);
    expect(bounds.max.z).toBeCloseTo(41);
    expect(bounds.min.y).toBe(2);
    expect(bounds.max.y).toBeGreaterThan(2);
  });
});
