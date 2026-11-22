import { Box3, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { brickConstructionBounds, CONSTRUCTION_FLOOR_MARGIN, constructionArea, createStudGridGeometry, MAX_STUD_GRID_LINES, MIN_CONSTRUCTION_FLOOR_SIZE } from "./construction-floor";

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

  it("keeps a minimum 32 by 32 stud floor even for tiny models", () => {
    const area = constructionArea(new Box3(new Vector3(4.2, 0, -1.1), new Vector3(7.8, 3, 2.3)));
    expect(area.width).toBeGreaterThanOrEqual(MIN_CONSTRUCTION_FLOOR_SIZE);
    expect(area.depth).toBeGreaterThanOrEqual(MIN_CONSTRUCTION_FLOOR_SIZE);
    expect(area.minX).toBeLessThanOrEqual(4.2 - CONSTRUCTION_FLOOR_MARGIN);
    expect(area.maxX).toBeGreaterThanOrEqual(7.8 + CONSTRUCTION_FLOOR_MARGIN);
    expect(area.minZ).toBeLessThanOrEqual(-1.1 - CONSTRUCTION_FLOOR_MARGIN);
    expect(area.maxZ).toBeGreaterThanOrEqual(2.3 + CONSTRUCTION_FLOOR_MARGIN);
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
      const coordinate = vertices[index]! + area.centerX;
      if (Math.abs(coordinate - area.minX) > 0.001 && Math.abs(coordinate - area.maxX) > 0.001) {
        expect(coordinate / area.gridStride).toBeCloseTo(Math.round(coordinate / area.gridStride));
      }
    }
    geometry.dispose();
  });

  it("keeps huge-coordinate floor geometry precise and within the total line budget", () => {
    const bounds = new Box3(
      new Vector3(-1_000_000_000_000, 0, -800_000_000_000),
      new Vector3(1_000_000_000_000, 10, 800_000_000_000),
    );
    const area = constructionArea(bounds);
    const geometry = createStudGridGeometry(area);
    const position = geometry.getAttribute("position");
    const vertices = Array.from(position.array);
    let xLines = 0, zLines = 0;
    expect(area.gridStride).toBeGreaterThan(1);
    expect(position.count / 2).toBeLessThanOrEqual(MAX_STUD_GRID_LINES);
    expect(vertices.length % 6).toBe(0);
    expect(vertices.every(Number.isFinite)).toBe(true);

    const endpointTolerance = area.gridStride * 0.001;
    for (let index = 0; index < vertices.length; index += 6) {
      const [x1, , z1, x2, , z2] = vertices.slice(index, index + 6);
      if (x1 === x2) {
        xLines++;
        expect(Math.abs(z1! - (area.minZ - area.centerZ))).toBeLessThanOrEqual(endpointTolerance);
        expect(Math.abs(z2! - (area.maxZ - area.centerZ))).toBeLessThanOrEqual(endpointTolerance);
      } else {
        zLines++;
        expect(Math.abs(x1! - (area.minX - area.centerX))).toBeLessThanOrEqual(endpointTolerance);
        expect(Math.abs(x2! - (area.maxX - area.centerX))).toBeLessThanOrEqual(endpointTolerance);
      }
    }
    expect(xLines).toBeGreaterThan(0);
    expect(zLines).toBeGreaterThan(0);
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
