import { afterEach, expect, it, vi } from "vitest";
import { Box3, PerspectiveCamera, Vector3 } from "three";
import { BRICK_DEFINITIONS, BRICK_HEIGHT, type BrickType, type Brick } from "../editor/model";
import { brickBounds, brickTransformMatrix } from "../editor/brick-transform";
import { createLocalBrickGeometry, localBrickShape, localBrickTriangles } from "./local-brick-geometry";
import { FallbackRenderer } from "./BuilderCanvas";

afterEach(() => vi.unstubAllGlobals());

it.each(Object.keys(BRICK_DEFINITIONS) as BrickType[])("preserves preview dimensions and nominal stacking for %s", type => {
  const shape = localBrickShape(type), geometry = createLocalBrickGeometry(type);
  try {
    geometry.computeBoundingBox();
    const size = geometry.boundingBox!.getSize(new Vector3());
    expect(size.x).toBeCloseTo(BRICK_DEFINITIONS[type].studsX - 0.035);
    expect(size.z).toBeCloseTo(BRICK_DEFINITIONS[type].studsZ - 0.035);
    expect(size.y).toBeCloseTo(BRICK_HEIGHT - 0.08 + 0.16);
    expect(geometry.boundingBox!.min.y).toBeCloseTo(0, 7);
    expect(shape.studs).toHaveLength(BRICK_DEFINITIONS[type].studsX * BRICK_DEFINITIONS[type].studsZ);
    expect(shape.studs[0][1] - shape.studHeight / 2).toBeCloseTo(shape.bodyHeight);
    const flat = geometry.toNonIndexed();
    expect(localBrickTriangles(type)).toEqual(flat.getAttribute("position").array);
    flat.dispose();
    const lower: Brick = { id: "a", type, color: "#ff0000", x: 0, y: 0, z: 0, rotation: 0 };
    expect(brickBounds(lower).max.y).toBe(BRICK_HEIGHT);
    expect(brickBounds({ ...lower, y: BRICK_HEIGHT }).min.y).toBe(BRICK_HEIGHT);
  } finally { geometry.dispose(); }
});

it("projects real body and stud triangles in the fallback for tilted and stacked local bricks", () => {
  const triangles: number[][] = [];
  let path: number[] = [];
  const context = {
    setTransform() {}, clearRect() {}, fillRect() {}, save() {}, restore() {}, clip() {},
    beginPath() { path = []; },
    moveTo(x: number, y: number) { path.push(x, y); },
    lineTo(x: number, y: number) { path.push(x, y); },
    closePath() {}, stroke() {},
    fill() { if (path.length === 6) triangles.push(path.slice()); },
  };
  vi.stubGlobal("window", { devicePixelRatio: 1 });
  vi.stubGlobal("document", { createElement: () => ({ style: {}, getContext: () => context }) });
  const bricks: Brick[] = [
    { id: "a", type: "brick-2x4", color: "#ff0000", x: 0, y: 0, z: 0, rotation: 0 },
    { id: "b", type: "brick-2x2", color: "#00ff00", x: 0, y: BRICK_HEIGHT, z: 0, rotation: 90 },
    { id: "c", type: "brick-1x2", color: "#0000ff", x: 3, y: 2.4, z: 1, rotation: 35, tiltX: 28, tiltZ: -19 },
  ];
  const before = JSON.stringify(bricks);
  const camera = new PerspectiveCamera(40, 1, 0.1, 100);
  const target = new Vector3(0, 1.5, 0);
  camera.position.set(12, 11, 16); camera.lookAt(target); camera.updateMatrixWorld(true);
  const expected: number[][] = [];
  for (const brick of bricks) {
    const positions = localBrickTriangles(brick.type), matrix = brickTransformMatrix(brick);
    for (let index = 0; index < positions.length; index += 9) {
      const world = [0, 3, 6].map(offset => new Vector3().fromArray(positions, index + offset).applyMatrix4(matrix));
      const normal = world[1].clone().sub(world[0]).cross(world[2].clone().sub(world[0])).normalize();
      if (normal.dot(camera.position.clone().sub(world[0])) <= 0) continue;
      expected.push(world.flatMap(point => {
        point.project(camera);
        return [(point.x + 1) * 400, (1 - point.y) * 400];
      }));
    }
  }
  const renderer = new FallbackRenderer();
  renderer.setSize(800, 800);
  renderer.render(camera, target, bricks, null, undefined, 0, false, undefined, {
    minX: -5, maxX: 5, minZ: -5, maxZ: 5, width: 10, depth: 10, gridStride: 1,
  });
  const normalized = (faces: number[][]) => faces.map(face => face.map(value => value.toFixed(5)).join(",")).sort();
  expect(triangles.length).toBeGreaterThan(100);
  expect(normalized(triangles)).toEqual(normalized(expected));
  expect(JSON.stringify(bricks)).toBe(before);
  expect(new Box3().setFromPoints(bricks.map(brick => new Vector3(brick.x, brick.y, brick.z))).max.y).toBe(2.4);
});
