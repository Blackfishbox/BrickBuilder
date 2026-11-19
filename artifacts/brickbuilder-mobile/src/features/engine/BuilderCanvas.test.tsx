// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Box3, Euler, Group, Matrix4, PerspectiveCamera, Plane, Raycaster, Scene, Vector2, Vector3 } from "three";
import { engineFixture } from "./engine-fixtures";
import type { SoftwareScene } from "./software-scene";
import * as softwareRendering from "./software-scene";
import * as cameraGestures from "./camera-gesture";
import * as instructionOutlines from "../instructions/outlines";
import BuilderCanvas from "./BuilderCanvas";
import { constructionArea, createStudGridGeometry, brickConstructionBounds, MAX_STUD_GRID_LINES } from "./construction-floor";
import { instanceIndex } from "./instance-index";
import { compilePart, worldMatrix } from "./ldraw-geometry";
import { DEFAULT_INSTRUCTION_PHI, DEFAULT_INSTRUCTION_THETA } from "./instruction-camera";
import * as snapping from "../connections/engine";
import type { Contact } from "../connections/types";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { gunzipSync } from "fflate";
import { parseLDraw } from "../formats/ldraw/parser";
import type { ImportedModel } from "../formats/types";
import { createEmptyDocument, type Brick, type ToolMode } from "../editor/model";
import { moveImported, tiltImported } from "../editor/ldraw-editing";
import type { Affine } from "../formats/types";
import { connectionFixture, partLine } from "../connections/fixtures";
import { affine, describeConnections, matrix4, transformConnector } from "../connections/description";
import { axes, intervals, potentialPair, profileOverlap } from "../connections/profiles";
import { ConnectionOverlay } from "../connections/overlay";

const observed = vi.hoisted(() => ({
  scene: undefined as SoftwareScene | undefined,
  scene3d: undefined as Scene | undefined,
  camera: undefined as PerspectiveCamera | undefined,
  cameraPose: undefined as { target: number[]; distance: number } | undefined,
  webglEnabled: false,
  preparations: 0,
}));
vi.mock("three", async importOriginal => {
  const actual = await importOriginal<typeof import("three")>();
  class TestWebGLRenderer {
    readonly domElement: HTMLCanvasElement;
    shadowMap = { enabled: false, type: undefined as unknown };
    outputColorSpace: unknown;
    constructor(options: { canvas: HTMLCanvasElement }) { this.domElement = options.canvas; }
    setPixelRatio() {}
    setSize() {}
    render(scene: Scene, camera: PerspectiveCamera) { observed.scene3d = scene; observed.camera = camera; }
    dispose() {}
  }
  return { ...actual, WebGLRenderer: TestWebGLRenderer };
});
vi.mock("./software-scene", async importOriginal => {
  const actual = await importOriginal<typeof import("./software-scene")>();
  return { ...actual, createSoftwareScene: async (...args: Parameters<typeof actual.createSoftwareScene>) => {
    observed.preparations++;
    observed.scene = await actual.createSoftwareScene(...args);
    return observed.scene;
  } };
});
let root: Root, element: HTMLDivElement, host: HTMLElement;
let frames: Map<number, FrameRequestCallback>, nextFrame: number;
let resizeCallbacks: ResizeObserverCallback[], canvasHeight: number;
const context = new Proxy({}, { get: () => vi.fn(), set: () => true });
const contact: Contact = {
  id: "moving:socket|target:stud", movingId: "moving", movingConnectorId: "socket", targetId: "target", targetConnectorId: "stud",
  family: "cylinder", position: [0, 0, 0], orientation: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0], state: "candidate",
  evidence: [{ path: "p/stud.dat", line: 8, sha256: "a".repeat(64) }],
};
function flushFrame(): void {
  const callbacks = [...frames.values()]; frames.clear();
  act(() => { callbacks.forEach(callback => callback(performance.now())); });
}
function pointer(type: string, x: number, y: number, id = 1): void {
  pointerOn(host, type, x, y, id);
}
function pointerOn(target: HTMLElement, type: string, x: number, y: number, id = 1): void {
  act(() => {
    const event = new MouseEvent(type, { clientX: x, clientY: y, bubbles: true, cancelable: true });
    Object.defineProperty(event, "pointerId", { value: id });
    target.dispatchEvent(event);
  });
}
function pickPoint(): { x: number; y: number } {
  // Reproduce the initial fit used by the canvas, then project the source triangle center.
  const bounds = observed.scene!.bounds.clone();
  const offset = Math.max(0, -bounds.min.y); bounds.min.y += offset; bounds.max.y += offset;
  const target = bounds.getCenter(new Vector3()), radius = bounds.getSize(new Vector3()).length() / 2;
  const camera = new PerspectiveCamera(42, 1, 0.1, 4000), phi = 0.93, theta = 0.72;
  const distance = Math.max(8, radius / Math.sin(camera.fov * Math.PI / 360) * 1.08);
  camera.position.set(target.x + distance * Math.sin(phi) * Math.sin(theta), target.y + distance * Math.cos(phi), target.z + distance * Math.sin(phi) * Math.cos(theta));
  camera.lookAt(target); camera.updateMatrixWorld(true);
  const point = new Vector3(0.25, -0.25 + offset, 0).project(camera);
  return { x: (point.x + 1) * 300, y: (1 - point.y) * 300 };
}
function catalogProjection() {
  const bounds = observed.scene!.bounds.clone(), offset = Math.max(0, -bounds.min.y);
  bounds.translate(new Vector3(0, offset, 0));
  const target = bounds.getCenter(new Vector3()), radius = bounds.getSize(new Vector3()).length() / 2;
  const camera = new PerspectiveCamera(42, 1, 0.1, 4000), phi = 0.93, theta = 0.72;
  const distance = Math.max(8, radius / Math.sin(camera.fov * Math.PI / 360) * 1.08);
  camera.position.set(target.x + distance * Math.sin(phi) * Math.sin(theta), target.y + distance * Math.cos(phi), target.z + distance * Math.sin(phi) * Math.cos(theta));
  camera.lookAt(target); camera.updateMatrixWorld(true);
  return (x: number, y: number, z: number) => {
    const p = new Vector3(x, y + offset, z).project(camera);
    return { x: (p.x + 1) * 300, y: (1 - p.y) * 300 };
  };
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  frames = new Map(); nextFrame = 0; observed.scene = undefined; observed.scene3d = undefined;
  observed.camera = undefined; observed.cameraPose = undefined; observed.webglEnabled = false; observed.preparations = 0;
  resizeCallbacks = []; canvasHeight = 600;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { frames.set(++nextFrame, callback); return nextFrame; });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  vi.stubGlobal("ResizeObserver", class {
    constructor(callback: ResizeObserverCallback) { resizeCallbacks.push(callback); }
    observe() {}
    disconnect() {}
  });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(((kind: string) =>
    kind === "2d" ? context : observed.webglEnabled && kind === "webgl2" ? {} : null) as HTMLCanvasElement["getContext"]);
  const sceneAdd = Scene.prototype.add;
  vi.spyOn(Scene.prototype, "add").mockImplementation(function (...objects) {
    observed.scene3d = this;
    return sceneAdd.apply(this, objects);
  });
  const cameraLookAt = PerspectiveCamera.prototype.lookAt;
  vi.spyOn(PerspectiveCamera.prototype, "lookAt").mockImplementation(function (target: Vector3 | number, y?: number, z?: number) {
    observed.camera = this;
    if (target instanceof Vector3) observed.cameraPose = {
      target: target.toArray(), distance: this.position.distanceTo(target),
    };
    return cameraLookAt.call(this, target as Vector3, y, z);
  });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(() => ({
    x: 0, y: 0, left: 0, top: 0, right: 600, bottom: canvasHeight, width: 600, height: canvasHeight, toJSON() {},
  }));
  HTMLElement.prototype.setPointerCapture = vi.fn();
  HTMLElement.prototype.hasPointerCapture = () => false;
  HTMLElement.prototype.releasePointerCapture = vi.fn();
  element = document.createElement("div"); document.body.appendChild(element); root = createRoot(element);
});
afterEach(() => { act(() => root.unmount()); element.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function currentImportedBounds(webgl: boolean): Box3 {
  const bounds = new Box3();
  if (webgl) {
    const scene = observed.scene3d!;
    const modelRoot = scene.children.find(child => instanceIndex(child as Group)) as Group | undefined;
    for (const entry of instanceIndex(modelRoot!)?.records.values() ?? []) {
      if (!entry.bounds.isEmpty()) bounds.union(entry.bounds);
    }
  } else {
    for (const instanceBounds of observed.scene!.instanceBounds.values()) bounds.union(instanceBounds);
  }
  return bounds;
}

function currentImportedInstanceBounds(id: string, webgl: boolean): Box3 {
  if (webgl) {
    const modelRoot = observed.scene3d!.children.find(child => instanceIndex(child as Group)) as Group;
    return instanceIndex(modelRoot)!.records.get(id)!.bounds.clone();
  }
  return observed.scene!.instanceBounds.get(id)!.clone();
}

function transformedPartBounds(model: ImportedModel, instance: ImportedModel["instances"][number]): Box3 {
  const bounds = new Box3(), matrix = worldMatrix(instance.matrix), point = new Vector3();
  for (const surface of compilePart(model, instance.reference, "16")) {
    for (const positions of [surface.positions, surface.edges]) {
      for (let index = 0; index < positions.length; index += 3) {
        bounds.expandByPoint(point.fromArray(positions, index).applyMatrix4(matrix));
      }
    }
  }
  return bounds;
}

const basis = (matrix: Affine) => matrix.filter((_, index) => ![3, 7, 11].includes(index));

function licensedTiltedMechanicalPair(targetPart: string, movingPart: string) {
  const document = { ...createEmptyDocument(), imported: connectionFixture([
    partLine(targetPart), partLine(movingPart, 160),
  ].join("\n")) };
  const [target, moving] = document.imported.instances;
  const approaches: Record<string, { x: number; y: number; z: number }> = {
    "3700/2780": { x: 0.03, y: -0.5, z: 0.5 },
    "32064/3705": { x: 0.02, y: -0.5, z: 0.02 },
    "4085a/30374": { x: 0.02, y: -0.2, z: -1.02 },
  };
  const snap = snapping.snapConnection(document.imported, moving.id, approaches[`${targetPart}/${movingPart}`]);
  if (!snap) throw new Error(`Could not orient licensed example ${movingPart}/${targetPart}`);

  const tilts = { target: [30, -12] as const, moving: [-15, 24] as const };
  const aligned = matrix4(snap.matrix).setPosition(0, 0, 0);
  const targetTilt = new Matrix4().makeRotationFromEuler(new Euler(
    tilts.target[0] * Math.PI / 180, 0, tilts.target[1] * Math.PI / 180, "XYZ",
  ));
  const movingTilt = new Matrix4().makeRotationFromEuler(new Euler(
    tilts.moving[0] * Math.PI / 180, 0, tilts.moving[1] * Math.PI / 180, "XYZ",
  ));
  const ldrawToWorld = new Matrix4().makeScale(1, -1, 1);
  aligned.premultiply(ldrawToWorld.clone()
    .multiply(movingTilt.invert().multiply(targetTilt))
    .multiply(ldrawToWorld));
  const instances = [target, {
    ...moving,
    matrix: affine(aligned.setPosition(moving.matrix[3], moving.matrix[7], moving.matrix[11])),
  }];
  let tilted = { ...document, imported: { ...document.imported, instances } };
  tilted = tiltImported(tilted, target.id, ...tilts.target) as typeof tilted;
  tilted = tiltImported(tilted, moving.id, ...tilts.moving) as typeof tilted;
  const model = tilted.imported!;
  const targets = describeConnections(`${targetPart}.dat`, model).connectors
    .map(connector => transformConnector(connector, model.instances[0].matrix))
    .filter((connector): connector is NonNullable<typeof connector> => !!connector);
  const movers = describeConnections(`${movingPart}.dat`, model).connectors
    .map(connector => transformConnector(connector, model.instances[1].matrix))
    .filter((connector): connector is NonNullable<typeof connector> => !!connector);
  for (const a of movers) for (const b of targets) {
    if (!potentialPair(a, b)) continue;
    const aa = axes(a), bb = axes(b), direction = aa.y.dot(bb.y) > 0 ? 1 : -1;
    if (Math.abs(Math.abs(aa.y.dot(bb.y)) - 1) > 1e-4) continue;
    const offsets = intervals(a).flatMap(section => [section.lo * direction, section.hi * direction])
      .flatMap(movingEnd => intervals(b).flatMap(section => [section.lo - movingEnd, section.hi - movingEnd]));
    for (const offset of offsets) {
      if (!profileOverlap(a, b, offset, direction, aa.x.dot(bb.x))) continue;
      const delta = bb.position.clone().addScaledVector(bb.y, offset).sub(aa.position);
      return {
        document: tilted, id: model.instances[1].id, targetId: model.instances[0].id,
        movingConnectorId: a.id, targetConnectorId: b.id,
        desired: {
          x: (model.instances[1].matrix[3] + delta.x) / 20,
          y: -(model.instances[1].matrix[7] + delta.y) / 20,
          z: (model.instances[1].matrix[11] + delta.z) / 20,
        },
      };
    }
  }
  throw new Error(`No aligned licensed profile pair found for ${movingPart}/${targetPart}`);
}

function expectConstructionArea(bounds: Box3): void {
  const expected = constructionArea(bounds);
  const board = observed.scene3d!.getObjectByName("construction-floor") as import("three").Mesh;
  const grid = observed.scene3d!.getObjectByName("construction-grid") as import("three").LineSegments;
  expect(board.position.x).toBe(expected.centerX);
  expect(board.position.z).toBe(expected.centerZ);
  expect(board.geometry.parameters.width).toBe(expected.width);
  expect(board.geometry.parameters.depth).toBe(expected.depth);
  expect(grid.position.x).toBe(expected.centerX);
  expect(grid.position.z).toBe(expected.centerZ);
  expect(Array.from(grid.geometry.getAttribute("position").array)).toEqual(
    Array.from(createStudGridGeometry(expected).getAttribute("position").array),
  );
}

function expectCameraPose(expected: { target: number[]; distance: number }): void {
  expect(observed.cameraPose!.target).toEqual(expected.target);
  expect(observed.cameraPose!.distance).toBeCloseTo(expected.distance, 8);
}

for (const webgl of [true, false]) {
  it(`reuses spatial highlight groups across camera redraws in ${webgl ? "WebGL" : "software"} preview`, async () => {
    observed.webglEnabled = webgl;
    const imported = engineFixture(4, 1);
    imported.resources["parts/test.dat"].content = "4 16 -20 0 -20 20 0 -20 20 24 20 -20 24 20";
    imported.instances.forEach(part => { part.colorCode = "4"; });
    const bricks: Brick[] = [0, 2, 4, 6].map((x, index) => ({
      id: `local-${index}`, type: "brick-2x2", color: "#ff0000", x, y: 0, z: 6, rotation: 0,
    }));
    const focus = new Set([...imported.instances.map(part => part.id), ...bricks.map(part => part.id)]);
    const grouping = vi.spyOn(instructionOutlines, "groupInstructionHighlights");
    const drawing = vi.spyOn(instructionOutlines, "drawInstructionOutlines").mockImplementation(() => {});
    const props = { bricks, imported, instructionFocusIds: focus, showConstructionControls: false,
      selectedId: null, selectedType: "brick-2x2" as const, selectedColor: "#ff0000", toolMode: "view" as const,
      onPlace: vi.fn(), onSelect: vi.fn(), onMove: vi.fn() };
    await act(async () => root.render(<BuilderCanvas {...props} />));
    await act(async () => {
      await vi.waitFor(() => expect(webgl
        ? observed.scene3d?.children.some(child => instanceIndex(child as Group))
        : observed.scene).toBeTruthy());
    });
    flushFrame();
    const boxes = drawing.mock.lastCall![2] as Box3[];
    expect(boxes).toHaveLength(2);
    expect(boxes[1].min.y).toBeCloseTo(0); // Imported ground offset is applied only for drawing.
    const groupCalls = grouping.mock.calls.length;
    act(() => root.render(<BuilderCanvas {...props} viewRotation={[20, 35, -15]} />));
    flushFrame();
    expect(grouping).toHaveBeenCalledTimes(groupCalls);
    expect(drawing.mock.lastCall![2]).toBe(boxes);

    const outlinesBeforeToggle = drawing.mock.calls.length;
    act(() => root.render(<BuilderCanvas {...props} instructionFocusIds={undefined} />));
    flushFrame();
    expect(drawing).toHaveBeenCalledTimes(outlinesBeforeToggle);
    const moved = bricks.map(part => part.id === "local-3" ? { ...part, x: 20 } : part);
    act(() => root.render(<BuilderCanvas {...props} bricks={moved} />));
    flushFrame();
    expect(drawing.mock.lastCall![2]).toHaveLength(3);
  });
}

describe("frame-coalesced drag transactions", () => {
  for (const webgl of [true, false]) {
    const rendererName = webgl ? "WebGL" : "Kompatibilitätsansicht";
    it(`keeps the ground and camera current for directly built parts in ${rendererName}`, () => {
      observed.webglEnabled = webgl;
      const original: Brick = {
        id: "local", type: "brick-2x4", color: "#B40000", x: 0, y: 0, z: 0, rotation: 0,
      };
      const props = { bricks: [original], selectedId: null, selectedType: "brick-2x4" as const,
        selectedColor: "#B40000", toolMode: "select" as const, onMove: vi.fn(), onSelect: vi.fn(), onPlace: vi.fn() };
      act(() => root.render(<BuilderCanvas {...props} />));
      host = element.querySelector("[data-testid='canvas-3d']")!;
      flushFrame();
      const camera = { ...observed.cameraPose! };
      const renderStep = (bricks: Brick[]) => {
        act(() => root.render(<BuilderCanvas {...props} bricks={bricks} />));
        flushFrame();
        const bounds = bricks.reduce((result, brick) => result.union(brickConstructionBounds(brick)), new Box3());
        expectConstructionArea(bounds);
        expectCameraPose(camera);
      };

      renderStep([original, { ...original, id: "added", x: 48, z: -24 }]);
      renderStep([original, { ...original, id: "added", x: 96, z: 32 }]);
      renderStep([original]);
    });

    it(`renders a bounded grid for very large builds in ${rendererName}`, () => {
      observed.webglEnabled = webgl;
      const bricks: Brick[] = [
        { id: "west", type: "brick-2x4", color: "#B40000", x: -500_000, y: 0, z: -300_000, rotation: 0 },
        { id: "east", type: "brick-2x4", color: "#B40000", x: 500_000, y: 0, z: 300_000, rotation: 0 },
      ];
      const props = { bricks, selectedId: null, selectedType: "brick-2x4" as const,
        selectedColor: "#B40000", toolMode: "select" as const, onMove: vi.fn(), onSelect: vi.fn(), onPlace: vi.fn() };
      act(() => root.render(<BuilderCanvas {...props} />));
      host = element.querySelector("[data-testid='canvas-3d']")!;
      flushFrame();

      const bounds = bricks.reduce((result, brick) => result.union(brickConstructionBounds(brick)), new Box3());
      expectConstructionArea(bounds);
      const grid = observed.scene3d!.getObjectByName("construction-grid") as import("three").LineSegments;
      const position = grid.geometry.getAttribute("position");
      expect(position.count / 2).toBeLessThanOrEqual(MAX_STUD_GRID_LINES);
      expect(Array.from(position.array).every(Number.isFinite)).toBe(true);
      expect(observed.scene3d!.getObjectByName("construction-floor")).toBeDefined();
    });

    it(`keeps the ground and camera current for imported parts in ${rendererName}`, async () => {
      observed.webglEnabled = webgl;
      const model = engineFixture(1, 3);
      const props = { projectId: "floor-regression", bricks: [], imported: model, selectedId: null,
        selectedType: "brick-2x4" as const, selectedColor: "#B40000", toolMode: "select" as const,
        onMove: vi.fn(), onSelect: vi.fn(), onPlace: vi.fn() };
      act(() => root.render(<BuilderCanvas {...props} />));
      host = element.querySelector("[data-testid='canvas-3d']")!;
      await act(async () => {
        await vi.waitFor(() => expect(webgl ? instanceIndex(
          observed.scene3d!.children.find(child => instanceIndex(child as Group)) as Group,
        ) : observed.scene).toBeDefined());
      });
      flushFrame();
      const camera = { ...observed.cameraPose! };
      const remote = (x: number, z: number, rotationDegrees: number) => {
        const angle = rotationDegrees * Math.PI / 180;
        const cosine = Math.cos(angle), sine = Math.sin(angle);
        return {
          ...model.instances[0], id: "remote",
          matrix: [cosine, 0, sine, x * 20, 0, 1, 0, 0, -sine, 0, cosine, z * 20] as Affine,
        };
      };
      const renderStep = async (next: typeof model, expectedRemote?: typeof model.instances[number]) => {
        await act(async () => root.render(<BuilderCanvas {...props} imported={next} />));
        flushFrame();
        const bounds = currentImportedBounds(webgl);
        expectConstructionArea(bounds);
        if (expectedRemote) {
          const actual = currentImportedInstanceBounds(expectedRemote.id, webgl);
          const expected = transformedPartBounds(next, expectedRemote);
          const unrotated = transformedPartBounds(next, {
            ...expectedRemote, matrix: [1, 0, 0, expectedRemote.matrix[3], 0, 1, 0, 0, 0, 0, 1, expectedRemote.matrix[11]],
          });
          expect(expected.getSize(new Vector3()).x).not.toBeCloseTo(unrotated.getSize(new Vector3()).x, 5);
          expect(actual.min.x).toBeLessThanOrEqual(expected.min.x + 1e-5);
          expect(actual.max.x).toBeGreaterThanOrEqual(expected.max.x - 1e-5);
          expect(actual.min.z).toBeLessThanOrEqual(expected.min.z + 1e-5);
          expect(actual.max.z).toBeGreaterThanOrEqual(expected.max.z - 1e-5);
          const area = constructionArea(bounds);
          expect(area.minX).toBeLessThanOrEqual(actual.min.x);
          expect(area.maxX).toBeGreaterThanOrEqual(actual.max.x);
          expect(area.minZ).toBeLessThanOrEqual(actual.min.z);
          expect(area.maxZ).toBeGreaterThanOrEqual(actual.max.z);
        }
        expectCameraPose(camera);
      };

      const addedPart = remote(100, -60, 45);
      const added = { ...model, instances: [...model.instances, addedPart] };
      await renderStep(added, addedPart);
      const movedPart = remote(180, 72, 135);
      const moved = { ...added, instances: added.instances.map(instance =>
        instance.id === "remote" ? movedPart : instance) };
      await renderStep(moved, movedPart);
      await renderStep({ ...moved, instances: moved.instances.filter(instance => instance.id !== "remote") });
    });
  }

  it("applies the latest instruction focus after asynchronous preparation and reuses the software scene on toggles and steps", async () => {
    const model = engineFixture(4, 3), original = structuredClone(model);
    const props = { projectId: "focus", bricks: [], imported: model, selectedId: null,
      selectedType: "brick-1x2" as const, selectedColor: "#fff", toolMode: "select" as const,
      onMove: vi.fn(), onSelect: vi.fn(), onPlace: vi.fn() };
    act(() => root.render(<BuilderCanvas {...props} instructionFocusIds={new Set([model.instances[0].id])} />));
    const current = new Set([model.instances[1].id]);
    act(() => root.render(<BuilderCanvas {...props} instructionFocusIds={current} />));
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 30)); });
    flushFrame();
    const scene = observed.scene!, positions = scene.positions;
    expect(scene.instructionColors).toBeDefined();
    const display = [...scene.instructionColors!];
    act(() => root.render(<BuilderCanvas {...props} instructionFocusIds={new Set()} />));
    expect(scene.instructionColors).not.toEqual(display);
    act(() => root.render(<BuilderCanvas {...props} />));
    expect(scene.instructionColors).toBeUndefined();
    const cumulative = { ...model, instances: model.instances.slice(0, 2) };
    act(() => root.render(<BuilderCanvas {...props} imported={cumulative} instructionFocusIds={current} />));
    expect(observed.scene).toBe(scene); expect(scene.positions).toBe(positions);
    expect(observed.preparations).toBe(1); expect(scene.transformedTriangles).toBe(0);
    expect(scene.instructionColors).toBeDefined();
    expect(model).toEqual(original);
  });
  it("keeps floating diagnostics off by default and enables and clears them on demand", () => {
    const props = { bricks: [{ id: "air", type: "brick-1x2" as const, color: "#fff", x: 0, y: 3, z: 0, rotation: 0 }],
      selectedId: null, selectedType: "brick-1x2" as const, selectedColor: "#fff", toolMode: "select" as const,
      onMove: vi.fn(), onSelect: vi.fn(), onPlace: vi.fn() };
    act(() => root.render(<BuilderCanvas {...props} />));
    const toggle = element.querySelector<HTMLButtonElement>("[aria-label='Schwebewarnung anzeigen']")!;
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    expect(element.querySelector("[data-testid='floating-warning']")).toBeNull();
    act(() => toggle.click());
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    expect(element.querySelector("[data-testid='floating-warning']")?.textContent).toContain("1 Teil");
    act(() => toggle.click());
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    expect(element.querySelector("[data-testid='floating-warning']")).toBeNull();
  });
  it("keeps connection suggestions optional and independently toggleable", () => {
    const props = { bricks: [], selectedId: null, selectedType: "brick-1x2" as const, selectedColor: "#fff",
      toolMode: "select" as const, onMove: vi.fn(), onSelect: vi.fn(), onPlace: vi.fn() };
    act(() => root.render(<BuilderCanvas {...props} />));
    const toggle = element.querySelector<HTMLButtonElement>("[aria-label='Verbindungsvorschau anzeigen']")!;
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    act(() => toggle.click());
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    act(() => toggle.click());
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
  });
  it("shows the labeled suggestion search distance only while suggestions are enabled", () => {
    const props = { bricks: [], selectedId: null, selectedType: "brick-1x2" as const, selectedColor: "#fff",
      toolMode: "select" as const, onMove: vi.fn(), onSelect: vi.fn(), onPlace: vi.fn() };
    act(() => root.render(<BuilderCanvas {...props} />));
    expect(element.querySelector("[data-testid='connection-preview-range']")).toBeNull();
    const toggle = element.querySelector<HTMLButtonElement>("[aria-label='Verbindungsvorschau anzeigen']")!;
    act(() => toggle.click());
    const range = element.querySelector<HTMLInputElement>("[data-testid='connection-preview-range']")!;
    expect(range.value).toBe("1.5");
    expect(range.getAttribute("aria-label")).toBe("Suchabstand für Verbindungsvorschläge");
    expect(element.querySelector(".connection-preview-setting > span")?.textContent).toBe("Suchabstand für Verbindungsvorschläge");
    expect(element.querySelector("[data-testid='connection-preview-range-value']")?.textContent).toBe("bis 1,5 Noppen");
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(range, "3");
      range.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(range.value).toBe("3");
    expect(element.querySelector("[data-testid='connection-preview-range-value']")?.textContent).toBe("bis 3 Noppen");
    act(() => toggle.click());
    expect(element.querySelector("[data-testid='connection-preview-range']")).toBeNull();
  });
  it("keeps slider drags from starting a canvas camera gesture", async () => {
    await mount("select");
    act(() => element.querySelector<HTMLButtonElement>("[aria-label='Verbindungsvorschau anzeigen']")!.click());
    const range = element.querySelector<HTMLInputElement>("[data-testid='connection-preview-range']")!;
    const capturePointer = vi.mocked(host.setPointerCapture);
    capturePointer.mockClear();

    pointerOn(range, "pointerdown", 120, 150);
    pointerOn(range, "pointermove", 180, 150);
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(range, "3");
      range.dispatchEvent(new Event("input", { bubbles: true }));
    });
    pointerOn(range, "pointerup", 180, 150);

    expect(range.value).toBe("3");
    expect(capturePointer).not.toHaveBeenCalled();
  });
  it("can hide the construction status controls while another overlay is open", () => {
    const props = { bricks: [], selectedId: null, selectedType: "brick-1x2" as const, selectedColor: "#fff",
      toolMode: "select" as const, onMove: vi.fn(), onSelect: vi.fn(), onPlace: vi.fn(), showConstructionControls: false };
    act(() => root.render(<BuilderCanvas {...props} />));
    expect(element.querySelector("[data-testid='construction-controls']")).toBeNull();
    expect(element.querySelector("[aria-label='Verbindungen anzeigen']")).toBeNull();
    expect(element.querySelector("[aria-label='Verbindungsvorschau anzeigen']")).toBeNull();
    expect(element.querySelector("[aria-label='Schwebewarnung anzeigen']")).toBeNull();
  });
  it("hides construction controls in view-only mode", () => {
    const props = { bricks: [], selectedId: null, selectedType: "brick-1x2" as const, selectedColor: "#fff",
      toolMode: "view" as const, onMove: vi.fn(), onSelect: vi.fn(), onPlace: vi.fn() };
    act(() => root.render(<BuilderCanvas {...props} />));
    expect(element.querySelector("[data-testid='construction-controls']")).toBeNull();
    expect(element.querySelector("[aria-label='Verbindungen anzeigen']")).toBeNull();
    expect(element.querySelector("[aria-label='Verbindungsvorschau anzeigen']")).toBeNull();
    expect(element.querySelector("[aria-label='Schwebewarnung anzeigen']")).toBeNull();
  });
  it("drags real catalog plate geometry onto both rows with live contacts and identical committed rendering", async () => {
    const snapshot = JSON.parse(new TextDecoder().decode(gunzipSync(readFileSync(resolve("public/parts/import-geometry-2026-10-31.bin")))));
    const sourceText = "1 4 0 -8 0 1 0 0 0 1 0 0 0 1 3795.dat\n1 7 80 -8 0 1 0 0 0 1 0 0 0 1 3023b.dat";
    const model: ImportedModel = { version: 1, format: "ldr", sourceName: "catalog.ldr", sourceText,
      originalBytes: [...new TextEncoder().encode(sourceText)], ...parseLDraw(sourceText),
      resources: Object.fromEntries(snapshot.files.map((f: { path: string }) => [f.path, f])), legalDocuments: snapshot.legalDocuments };
    model.instances.forEach(instance => { instance.part.status = "resolved"; });
    const id = model.instances[1].id, onMove = vi.fn();
    const props = { projectId: "catalog", bricks: [], imported: model, selectedId: id,
      selectedType: "brick-1x2" as const, selectedColor: "#B40000", toolMode: "select" as const,
      onMove, onSelect: vi.fn(), onPlace: vi.fn() };
    act(() => root.render(<BuilderCanvas {...props} />));
    await act(async () => { await vi.waitFor(() => expect(observed.scene).toBeDefined()); });
    host = element.querySelector("[data-testid='canvas-3d']")!;
    flushFrame();
    const project = catalogProjection(), start = project(4, 0.4, 0), end = project(0.03, 0.4, 0.52);
    const suggestions = vi.spyOn(snapping, "previewConnections");
    act(() => element.querySelector<HTMLButtonElement>("[aria-label='Verbindungsvorschau anzeigen']")!.click());
    const range = element.querySelector<HTMLInputElement>("[data-testid='connection-preview-range']")!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(range, "3");
      range.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const search = vi.spyOn(snapping, "magneticConstructionTransform");
    pointer("pointerdown", start.x, start.y);
    pointer("pointermove", end.x, end.y);
    flushFrame();
    expect(search).toHaveBeenCalledOnce();
    expect(suggestions).toHaveBeenCalledOnce();
    expect(suggestions.mock.calls[0][3]).toBe(3);
    expect(search.mock.calls[0]).toEqual([model, id, expect.any(Object), undefined]);
    const transform = search.mock.results[0].value.transform;
    expect(transform.contacts).toHaveLength(2);
    expect(transform.matrix).toEqual([1, 0, 0, 0, 0, 1, 0, -16, 0, 0, 1, 10]);
    expect(element.querySelector("[data-testid='connection-status']")?.textContent).toContain("2 Verbindungen");
    const preview = observed.scene!.positions.slice();
    pointer("pointerup", end.x, end.y);
    expect(onMove).toHaveBeenCalledOnce();
    expect(onMove.mock.calls[0][2]).toEqual(transform.matrix);
    const committed = moveImported({ ...createEmptyDocument(), imported: model }, id, onMove.mock.calls[0][1], false, onMove.mock.calls[0][2]);
    act(() => root.render(<BuilderCanvas {...props} imported={committed.imported} />));
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 30)); });
    flushFrame();
    expect(observed.scene!.positions).toEqual(preview);
    expect(snapping.activeConnections(committed.imported!, id)).toHaveLength(2);
  });
  for (const webgl of [true, false]) {
    it(`previews and commits real tilted stud contacts with ${webgl ? "WebGL" : "software rendering"}`, async () => {
      observed.webglEnabled = webgl;
      let document = { ...createEmptyDocument(), imported: connectionFixture([
        partLine("3001", 4.6, -200, 3.4), partLine("3003", 160, -200),
      ].join("\n")) };
      const [target, moving] = document.imported.instances;
      for (const instance of [target, moving]) {
        document = tiltImported(document, instance.id, 27, -18) as typeof document;
      }
      const expected = affine(matrix4(document.imported.instances[0].matrix).multiply(new Matrix4().makeTranslation(0, -24, 0)));
      document = moveImported(document, moving.id, {
        x: expected[3] / 20 + 4, y: -expected[7] / 20, z: expected[11] / 20,
      }, false) as typeof document;
      const model = document.imported, id = moving.id, onMove = vi.fn();
      const props = { projectId: "tilted-studs", bricks: [], imported: model, selectedId: id,
        selectedType: "brick-2x2" as const, selectedColor: "#B40000", toolMode: "select" as const,
        onMove, onSelect: vi.fn(), onPlace: vi.fn() };
      act(() => root.render(<BuilderCanvas {...props} />));
      await act(async () => {
        await vi.waitFor(() => expect(webgl ? observed.scene3d && currentImportedBounds(true).isEmpty() === false : observed.scene).toBeTruthy());
      });
      host = element.querySelector("[data-testid='canvas-3d']")!;
      flushFrame();
      const camera = observed.camera!, bounds = currentImportedBounds(webgl);
      const offset = Math.max(0, -bounds.min.y), matrix = model.instances[1].matrix;
      const toScreen = (point: Vector3) => {
        const p = point.clone().project(camera);
        return { x: (p.x + 1) * 300, y: (1 - p.y) * 300 };
      };
      const start = toScreen(currentImportedInstanceBounds(id, webgl).getCenter(new Vector3()).add(new Vector3(0, offset, 0)));
      const ray = new Raycaster();
      ray.setFromCamera(new Vector2((start.x - 300) / 300, (300 - start.y) / 300), camera);
      const planeStart = ray.ray.intersectPlane(new Plane(new Vector3(0, 1, 0), matrix[7] / 20 - offset), new Vector3())!;
      const end = toScreen(planeStart.clone().add(new Vector3((expected[3] - matrix[3]) / 20 + 0.03, 0, 0.02)));
      const search = vi.spyOn(snapping, "magneticConstructionTransform");
      pointer("pointerdown", start.x, start.y);
      expect(props.onSelect).toHaveBeenCalledWith(id);
      pointer("pointermove", end.x, end.y);
      flushFrame();
      expect(search).toHaveBeenCalledOnce();
      const transform = search.mock.results[0].value.transform;
      expect(transform.contacts.length).toBeGreaterThan(0);
      expected.forEach((n, i) => expect(transform.matrix[i]).toBeCloseTo(n, 9));
      expect(element.querySelector("[data-testid='connection-status']")?.textContent).toContain("Magnetisch eingerastet");
      const previewBounds = currentImportedInstanceBounds(id, webgl);
      pointer("pointerup", end.x, end.y);
      expect(onMove).toHaveBeenCalledOnce();
      expect(onMove.mock.calls[0][2]).toEqual(transform.matrix);
      const committed = moveImported(document, id, onMove.mock.calls[0][1], false, onMove.mock.calls[0][2]);
      act(() => root.render(<BuilderCanvas {...props} imported={committed.imported} />));
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 30)); });
      flushFrame();
      const committedBounds = currentImportedInstanceBounds(id, webgl);
      expect(committedBounds.min.distanceTo(previewBounds.min)).toBeLessThan(1e-6);
      expect(committedBounds.max.distanceTo(previewBounds.max)).toBeLessThan(1e-6);
      expect(snapping.activeConnections(committed.imported!, id).length).toBeGreaterThan(0);
    });
  }
  for (const webgl of [true, false]) {
    for (const [targetPart, movingPart] of [["3700", "2780"], ["32064", "3705"], ["4085a", "30374"]] as const) {
      it(`renders committed mixed-tilt ${movingPart}/${targetPart} joints in ${webgl ? "WebGL" : "software view"}`, async () => {
        observed.webglEnabled = webgl;
        const pair = licensedTiltedMechanicalPair(targetPart, movingPart);
        const model = pair.document.imported!, moving = model.instances.find(instance => instance.id === pair.id)!;
        const result = snapping.constructionTransform(model, pair.id, pair.desired);
        expect(result.contacts.some(contact => contact.movingConnectorId === pair.movingConnectorId &&
          contact.targetConnectorId === pair.targetConnectorId)).toBe(true);
        expect(basis(result.matrix)).toEqual(basis(moving.matrix));
        const committed = moveImported(pair.document, pair.id, {
          x: result.matrix[3] / 20, y: -result.matrix[7] / 20, z: result.matrix[11] / 20,
        }, false, result.matrix);
        const committedModel = committed.imported!;
        const markerArc = vi.fn();
        const overlayContext = new Proxy({ arc: markerArc }, {
          get: (target, key: string) => key in target ? target[key as keyof typeof target] : vi.fn(),
          set: () => true,
        });
        vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(((kind: string) =>
          kind === "2d" ? overlayContext : observed.webglEnabled && kind === "webgl2" ? {} : null) as HTMLCanvasElement["getContext"]);
        const overlayDraw = vi.spyOn(ConnectionOverlay.prototype, "draw");
        const props = { projectId: `mixed-tilt-${targetPart}-${movingPart}`, bricks: [], imported: committedModel,
          selectedId: pair.id, selectedType: "brick-2x2" as const, selectedColor: "#B40000",
          toolMode: "select" as const, onMove: vi.fn(), onSelect: vi.fn(), onPlace: vi.fn() };
        act(() => root.render(<BuilderCanvas {...props} />));
        await act(async () => {
          await vi.waitFor(() => {
            const root = webgl
              ? observed.scene3d?.children.find(child => instanceIndex(child as Group)) as Group | undefined
              : undefined;
            expect(webgl ? root && instanceIndex(root)?.model : observed.scene?.model).toBe(committedModel);
          });
        });
        host = element.querySelector("[data-testid='canvas-3d']")!;
        flushFrame();

        const committedMoving = committedModel.instances.find(instance => instance.id === pair.id)!;
        for (const instance of [committedModel.instances.find(value => value.id === pair.targetId)!, committedMoving]) {
          const actual = currentImportedInstanceBounds(instance.id, webgl);
          const expected = transformedPartBounds(committedModel, instance);
          const rendered = webgl
            ? instanceIndex(observed.scene3d!.children.find(child => instanceIndex(child as Group)) as Group)!.records.get(instance.id)!.instance
            : observed.scene!.records.get(instance.id)!.instance;
          expect(rendered.matrix).toEqual(instance.matrix);
          expect(actual.min.distanceTo(expected.min)).toBeLessThan(0.25);
          expect(actual.max.distanceTo(expected.max)).toBeLessThan(0.25);
        }
        expect(element.querySelector("[data-testid='connection-status']")?.textContent)
          .toContain("geprüfte Verbindung");
        expect(overlayDraw.mock.contexts.some(context =>
          (context as ConnectionOverlay).contacts.some(contact =>
            contact.movingConnectorId === pair.movingConnectorId &&
            contact.targetConnectorId === pair.targetConnectorId &&
            contact.state === "verified"))).toBe(true);
        expect(markerArc.mock.calls.some(([, , radius]) => radius === 5)).toBe(true);
      });
    }
  }
  for (const [targetPart, movingPart] of [["3700", "2780"], ["32064", "3705"], ["4085a", "30374"]] as const) {
    it(`leaves a misaligned ${movingPart}/${targetPart} near-miss visibly unconnected`, async () => {
      const aligned = licensedTiltedMechanicalPair(targetPart, movingPart);
      const document = tiltImported(aligned.document, aligned.id, -15, 28) as typeof aligned.document;
      const model = document.imported!;
      const target = model.instances.find(instance => instance.id === aligned.targetId)!;
      const moving = model.instances.find(instance => instance.id === aligned.id)!;
      const a = describeConnections(`${movingPart}.dat`, model).connectors
        .map(connector => transformConnector(connector, moving.matrix)).find(connector => connector?.id === aligned.movingConnectorId)!;
      const b = describeConnections(`${targetPart}.dat`, model).connectors
        .map(connector => transformConnector(connector, target.matrix)).find(connector => connector?.id === aligned.targetConnectorId)!;
      const aa = axes(a), bb = axes(b), offset = aa.position.clone().sub(bb.position).dot(bb.y);
      const delta = bb.position.clone().addScaledVector(bb.y, offset).sub(aa.position);
      const desired = {
        x: (moving.matrix[3] + delta.x) / 20,
        y: -(moving.matrix[7] + delta.y) / 20,
        z: (moving.matrix[11] + delta.z) / 20,
      };
      const result = snapping.constructionTransform(model, aligned.id, desired);
      expect(result.status).toBe("unconnected");
      expect(result.contacts.some(contact => contact.movingConnectorId === aligned.movingConnectorId &&
        contact.targetConnectorId === aligned.targetConnectorId)).toBe(false);
      expect(basis(result.matrix)).toEqual(basis(moving.matrix));
      const committed = moveImported(document, aligned.id, {
        x: result.matrix[3] / 20, y: -result.matrix[7] / 20, z: result.matrix[11] / 20,
      }, false, result.matrix);
      const committedModel = committed.imported!;
      const markerArc = vi.fn();
      const overlayContext = new Proxy({ arc: markerArc }, {
        get: (target, key: string) => key in target ? target[key as keyof typeof target] : vi.fn(),
        set: () => true,
      });
      vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(((kind: string) =>
        kind === "2d" ? overlayContext : null) as HTMLCanvasElement["getContext"]);
      const overlayDraw = vi.spyOn(ConnectionOverlay.prototype, "draw");
      const props = { projectId: `near-miss-${targetPart}-${movingPart}`, bricks: [], imported: committedModel,
        selectedId: aligned.id, selectedType: "brick-2x2" as const, selectedColor: "#B40000",
        toolMode: "select" as const, onMove: vi.fn(), onSelect: vi.fn(), onPlace: vi.fn() };
      act(() => root.render(<BuilderCanvas {...props} />));
      await act(async () => { await vi.waitFor(() => expect(observed.scene?.model).toBe(committedModel)); });
      host = element.querySelector("[data-testid='canvas-3d']")!;
      await act(async () => {
        await vi.waitFor(() => expect(snapping.activeConnections(committedModel, aligned.id)).toHaveLength(0));
      });
      flushFrame();
      expect(element.querySelector("[data-testid='connection-status']")?.textContent)
        .toContain("Keine aktive Verbindung");
      expect(overlayDraw.mock.contexts.some(context =>
        (context as ConnectionOverlay).contacts.some(contact =>
          contact.movingConnectorId === aligned.movingConnectorId &&
          contact.targetConnectorId === aligned.targetConnectorId))).toBe(false);
      expect(markerArc.mock.calls.some(([, , radius]) => radius === 5)).toBe(false);
      expect(snapping.activeConnections(committedModel, aligned.id).some(contact =>
        contact.movingConnectorId === aligned.movingConnectorId &&
        contact.targetConnectorId === aligned.targetConnectorId)).toBe(false);
    });
  }
  for (const webgl of [true, false]) {
    const rendererName = webgl ? "WebGL" : "Kompatibilitätsansicht";
    it(`expands the floor for a drag preview and restores it on cancellation in ${rendererName}`, async () => {
      observed.webglEnabled = webgl;
      const model = engineFixture(1, 2);
      const props = { projectId: `floor-preview-${rendererName}`, bricks: [], imported: model,
        selectedId: model.instances[0].id, selectedType: "brick-2x4" as const, selectedColor: "#B40000",
        toolMode: "select" as const, onMove: vi.fn(), onSelect: vi.fn(), onPlace: vi.fn() };
      act(() => root.render(<BuilderCanvas {...props} />));
      await act(async () => {
        await vi.waitFor(() => expect(webgl ? instanceIndex(
          observed.scene3d!.children.find(child => instanceIndex(child as Group)) as Group,
        ) : observed.scene).toBeDefined());
      });
      host = element.querySelector("[data-testid='canvas-3d']")!;
      flushFrame();

      const committedBounds = currentImportedBounds(webgl);
      const committedArea = constructionArea(committedBounds);
      const camera = { ...observed.cameraPose! };
      expectConstructionArea(committedBounds);

      vi.spyOn(snapping, "magneticConstructionTransform").mockReturnValue({
        transform: {
          matrix: [1, 0, 0, 6000, 0, 1, 0, 0, 0, 0, 1, 0],
          contacts: [],
          status: "unconnected",
        },
      });
      const projected = new Vector3(1 / 3, 2 / 3, 0).project(observed.camera!);
      const point = { x: (projected.x + 1) * 300, y: (1 - projected.y) * 300 };
      pointer("pointerdown", point.x, point.y);
      pointer("pointermove", point.x + 80, point.y + 10);
      flushFrame();

      expect(snapping.magneticConstructionTransform).toHaveBeenCalledOnce();
      const previewBounds = currentImportedBounds(webgl);
      const previewFloorBounds = committedBounds.clone().union(previewBounds);
      const previewArea = constructionArea(previewFloorBounds);
      expect(previewBounds.max.x).toBeGreaterThan(committedBounds.max.x + 10);
      expect(previewArea.width).toBeGreaterThan(committedArea.width);
      expectConstructionArea(previewFloorBounds);
      expectCameraPose(camera);

      pointer("pointercancel", point.x + 80, point.y + 10);

      expect(props.onMove).not.toHaveBeenCalled();
      expect(currentImportedBounds(webgl).max.x).toBeCloseTo(committedBounds.max.x);
      expectConstructionArea(committedBounds);
      expectCameraPose(camera);
    });
  }
  for (const webgl of [true, false]) {
    const rendererName = webgl ? "WebGL" : "Kompatibilitätsansicht";
    it(`updates and restores the floor for a built-part drag in ${rendererName}`, () => {
      observed.webglEnabled = webgl;
      const original: Brick = {
        id: "local-preview", type: "brick-2x4", color: "#B40000", x: 0, y: 0, z: 0, rotation: 0,
      };
      const props = { bricks: [original], selectedId: null, selectedType: "brick-2x4" as const,
        selectedColor: "#B40000", toolMode: "select" as const, onMove: vi.fn(), onSelect: vi.fn(), onPlace: vi.fn() };
      act(() => root.render(<BuilderCanvas {...props} />));
      host = element.querySelector("[data-testid='canvas-3d']")!;
      flushFrame();

      const committedBounds = brickConstructionBounds(original);
      const committedArea = constructionArea(committedBounds);
      const camera = { ...observed.cameraPose! };
      expectConstructionArea(committedBounds);
      observed.camera!.updateMatrixWorld(true);
      const screenPoint = (x: number, y: number, z: number) => {
        const projected = new Vector3(x, y, z).project(observed.camera!);
        return { x: (projected.x + 1) * 300, y: (1 - projected.y) * 300 };
      };
      const start = screenPoint(0, 1.11, 0);
      const end = screenPoint(-20, original.y, 0);
      const pointOnGround = (point: { x: number; y: number }) => {
        const raycaster = new Raycaster();
        raycaster.setFromCamera(new Vector2((point.x - 300) / 300, (300 - point.y) / 300), observed.camera!);
        return raycaster.ray.intersectPlane(new Plane(new Vector3(0, 1, 0), -original.y), new Vector3())!;
      };
      const startOnGround = pointOnGround(start), endOnGround = pointOnGround(end);
      const previewBrick = {
        ...original,
        x: Math.round((original.x + endOnGround.x - startOnGround.x) * 2) / 2,
        z: Math.round((original.z + endOnGround.z - startOnGround.z) * 2) / 2,
      };
      pointer("pointerdown", start.x, start.y);
      expect(props.onSelect).toHaveBeenCalledWith(original.id);
      pointer("pointermove", end.x, end.y);
      flushFrame();

      const previewBounds = committedBounds.clone().union(brickConstructionBounds(previewBrick));
      expect(constructionArea(previewBounds).width).toBeGreaterThan(committedArea.width);
      expectConstructionArea(previewBounds);
      expectCameraPose(camera);

      pointer("pointercancel", end.x, end.y);

      expect(props.onMove).not.toHaveBeenCalled();
      expectConstructionArea(committedBounds);
      expectCameraPose(camera);
    });
  }
  async function mount(toolMode: ToolMode = "select") {
    const model = engineFixture(1, 2), onMove = vi.fn(), onSelect = vi.fn();
    const props = { projectId: "one", bricks: [], imported: model, selectedId: model.instances[0].id,
      selectedType: "brick-2x4" as const, selectedColor: "#B40000", toolMode, onMove, onSelect, onPlace: vi.fn() };
    act(() => { root.render(<BuilderCanvas {...props} />); });
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 30)); });
    host = element.querySelector("[data-testid='canvas-3d']")!;
    flushFrame();
    expect(observed.scene).toBeDefined();
    return { model, onMove, props, point: pickPoint() };
  }
  it("preserves the user's zoom when the selection controls resize the canvas", async () => {
    await mount("view");
    const gesture = vi.spyOn(cameraGestures, "cameraGesture");
    pointer("pointerdown", 240, 300, 1);
    pointer("pointerdown", 290, 300, 2);
    pointer("pointermove", 340, 300, 2);
    flushFrame();
    const zoomedDistance = gesture.mock.results.at(-1)!.value.distance;
    expect(zoomedDistance).toBeLessThan(gesture.mock.calls[0][0].camera.distance);
    pointer("pointerup", 340, 300, 2);
    pointer("pointerup", 240, 300, 1);

    // Selecting a part makes the mobile action row reduce the canvas height.
    canvasHeight = 500;
    act(() => resizeCallbacks[0]([], {} as ResizeObserver));
    pointer("pointerdown", 240, 300, 1);
    pointer("pointerdown", 290, 300, 2);
    pointer("pointermove", 291, 300, 2);
    flushFrame();
    expect(gesture.mock.calls.at(-1)![0].camera.distance).toBeCloseTo(zoomedDistance);
  });
  it("reports the rotated and zoomed touch camera when an instruction gesture ends", async () => {
    const { props } = await mount("view");
    const onViewCameraChange = vi.fn();
    act(() => root.render(<BuilderCanvas {...props} viewStepId="step-2" onViewCameraChange={onViewCameraChange} />));
    const gesture = vi.spyOn(cameraGestures, "cameraGesture");
    pointer("pointerdown", 240, 300, 1);
    pointer("pointerdown", 290, 300, 2);
    pointer("pointermove", 340, 330, 2);
    pointer("pointerup", 340, 330, 2);
    const saved = onViewCameraChange.mock.lastCall![0];
    const moved = gesture.mock.results.at(-1)!.value;
    expect(saved.distance).toBeCloseTo(moved.distance);
    expect(saved.theta).toBe(DEFAULT_INSTRUCTION_THETA);
    expect(saved.phi).toBe(DEFAULT_INSTRUCTION_PHI);
    expect(onViewCameraChange.mock.lastCall![1]).toHaveLength(3);
    expect(saved.target).toHaveLength(3);
    expect(saved.referenceDistance).toBeGreaterThan(0);
  });
  it("does not convert a two-finger pan or zoom into instruction rotation", async () => {
    const { props } = await mount("view");
    const onViewCameraChange = vi.fn();
    act(() => root.render(<BuilderCanvas {...props} viewStepId="pan-only" onViewCameraChange={onViewCameraChange} />));
    pointer("pointerdown", 240, 300, 1);
    pointer("pointerdown", 290, 300, 2);
    pointer("pointermove", 340, 300, 2);
    pointer("pointerup", 340, 300, 2);
    expect(onViewCameraChange).toHaveBeenCalledOnce();
    expect(onViewCameraChange.mock.lastCall![1]).toBeUndefined();
  });
  for (const toolMode of ["view", "build", "select", "delete"] as const) {
    it(`takes over touches on parts in ${toolMode} without editor transactions`, async () => {
      const { props, point, model } = await mount(toolMode);
      const original = observed.scene!.positions.slice();
      const gesture = vi.spyOn(cameraGestures, "cameraGesture");
      pointer("pointerdown", point.x, point.y);
      if (toolMode === "delete") expect(props.onSelect).not.toHaveBeenCalled();
      const selections = props.onSelect.mock.calls.length;
      pointer("pointerdown", point.x + 180, point.y, 2);
      pointer("pointermove", point.x + 40, point.y + 30);
      pointer("pointermove", point.x + 220, point.y + 30, 2);
      flushFrame();
      const next = gesture.mock.results.at(-1)!.value;
      const start = gesture.mock.calls[0][0].camera;
      expect(next.theta).toBe(start.theta); expect(next.phi).toBe(start.phi);
      expect(next.distance).toBeCloseTo(start.distance);
      expect(next.target).not.toEqual(start.target);
      pointer("pointerup", point.x + 220, point.y + 30, 2);
      const count = gesture.mock.calls.length;
      pointer("pointermove", point.x + 80, point.y + 80);
      pointer("pointerup", point.x + 80, point.y + 80);
      pointer("pointerup", point.x + 80, point.y + 80);
      expect(gesture).toHaveBeenCalledTimes(count);
      expect(props.onMove).not.toHaveBeenCalled();
      expect(props.onPlace).not.toHaveBeenCalled();
      expect(props.onSelect).toHaveBeenCalledTimes(selections);
      expect(observed.scene!.positions).toEqual(original);
      expect(model.instances[0].matrix).toEqual(props.imported.instances[0].matrix);
    });
  }
  for (const end of ["pointerup", "pointercancel", "lostpointercapture"]) {
    it(`rebases after ${end} with a third finger and starts fresh gestures from the current camera`, async () => {
      const { props } = await mount("build");
      const gesture = vi.spyOn(cameraGestures, "cameraGesture");
      pointer("pointerdown", 20, 30);
      pointer("pointerdown", 220, 30, 2);
      pointer("pointermove", 40, 50);
      pointer("pointermove", 240, 50, 2);
      const before = gesture.mock.results.at(-1)!.value;
      pointer("pointerdown", 400, 400, 3);
      const count = gesture.mock.calls.length;
      pointer("pointermove", 450, 450, 3);
      expect(gesture).toHaveBeenCalledTimes(count);
      pointer(end, 40, 50);
      pointer("pointermove", 240, 50, 2);
      expect(gesture.mock.results.at(-1)!.value).toEqual(before);
      pointer("pointerup", 450, 450, 3);
      pointer("pointermove", 250, 60, 2);
      pointer("pointerdown", 100, 100, 4);
      pointer("pointermove", 100, 100, 4);
      expect(gesture.mock.results.at(-1)!.value).toEqual(before);
      pointer("pointerup", 100, 100, 4);
      pointer("pointerup", 250, 60, 2);
      pointer("pointerdown", 10, 10, 5);
      pointer("pointerdown", 210, 10, 6);
      pointer("pointermove", 210, 10, 6);
      expect(gesture.mock.calls.at(-1)![0].camera).toEqual(before);
      pointer("pointerup", 210, 10, 6); pointer("pointerup", 10, 10, 5);
      expect(props.onPlace).not.toHaveBeenCalled();
      expect(props.onMove).not.toHaveBeenCalled();
    });
  }
  it("clears a queued drag preview before two-finger takeover and still permits a new delete tap", async () => {
    const { props, point } = await mount();
    const original = observed.scene!.positions.slice();
    const preview = vi.spyOn(softwareRendering, "previewSoftware");
    pointer("pointerdown", point.x, point.y);
    pointer("pointermove", point.x + 50, point.y + 10);
    pointer("pointerdown", point.x - 100, point.y, 2);
    flushFrame();
    expect(preview).not.toHaveBeenCalled();
    expect(observed.scene!.positions).toEqual(original);
    pointer("pointerup", point.x + 50, point.y + 10);
    pointer("pointerup", point.x - 100, point.y, 2);
    expect(props.onMove).not.toHaveBeenCalled();
    act(() => root.render(<BuilderCanvas {...props} toolMode="delete" />));
    props.onSelect.mockClear();
    pointer("pointerdown", point.x, point.y);
    expect(props.onSelect).not.toHaveBeenCalled();
    pointer("pointerup", point.x, point.y);
    expect(props.onSelect).toHaveBeenCalledOnce();
  });
  it("previews at most once per frame without saves, then calls the editor exactly once", async () => {
    const { model, onMove, point, props } = await mount();
    const original = observed.scene!.positions.slice(), before = observed.scene!.transformedTriangles;
    pointer("pointerdown", point.x, point.y);
    expect(props.onSelect).toHaveBeenCalledWith(model.instances[0].id);
    for (let n = 1; n <= 20; n++) pointer("pointermove", point.x + n * 4, point.y + 10);
    expect(observed.scene!.transformedTriangles).toBe(before);
    expect(onMove).not.toHaveBeenCalled();
    flushFrame();
    expect(observed.scene!.positions).not.toEqual(original);
    expect(observed.scene!.transformedTriangles - before).toBe(observed.scene!.triangleCount);
    expect(model.instances[0].matrix[3]).toBe(0);
    pointer("pointerup", point.x + 80, point.y + 10);
    expect(onMove).toHaveBeenCalledOnce();
    const destination = onMove.mock.calls[0][1];
    expect(destination.x * 2).toBe(Math.round(destination.x * 2));
    expect(destination.z * 2).toBe(Math.round(destination.z * 2));
    expect(destination.y).toBeCloseTo(0);
    expect(observed.scene!.positions).toEqual(original);
    expect(observed.preparations).toBe(1);
  });
  it("coalesces connection searches and commits the exact off-grid live preview", async () => {
    const { onMove, point } = await mount();
    const preview = vi.spyOn(softwareRendering, "previewSoftware");
    const snap = vi.spyOn(snapping, "magneticConstructionTransform").mockReturnValue({ transform: { matrix: [1, 0, 0, 4.6, 0, 1, 0, -48, 0, 0, 1, 3.4], contacts: [], status: "candidate" } });
    pointer("pointerdown", point.x, point.y);
    for (let n = 1; n <= 20; n++) pointer("pointermove", point.x + n * 4, point.y + 10);
    expect(snap).not.toHaveBeenCalled();
    flushFrame();
    expect(snap).toHaveBeenCalledOnce();
    expect(preview.mock.calls.at(-1)?.[2]).toEqual(snap.mock.results[0].value.transform.matrix);
    pointer("pointerup", point.x + 80, point.y + 10);
    expect(snap).toHaveBeenCalledOnce();
    expect(onMove).toHaveBeenCalledOnce();
    expect(onMove.mock.calls[0][1].x).toBeCloseTo(0.23);
    expect(onMove.mock.calls[0][1].y).toBeCloseTo(2.4);
    expect(onMove.mock.calls[0][1].z).toBeCloseTo(0.17);
    expect(onMove.mock.calls[0][2]).toEqual(snap.mock.results[0].value.transform.matrix);
  });
  it("resolves a pending connection on release even before the next frame", async () => {
    const { onMove, point } = await mount();
    const snap = vi.spyOn(snapping, "magneticConstructionTransform").mockReturnValue({ transform: { matrix: [1, 0, 0, 4.6, 0, 1, 0, -48, 0, 0, 1, 3.4], contacts: [], status: "candidate" } });
    pointer("pointerdown", point.x, point.y);
    pointer("pointermove", point.x + 80, point.y + 10);
    pointer("pointerup", point.x + 80, point.y + 10);
    expect(snap).toHaveBeenCalledOnce();
    expect(onMove.mock.calls[0][1].x).toBeCloseTo(0.23);
    expect(onMove.mock.calls[0][1].y).toBeCloseTo(2.4);
    expect(onMove.mock.calls[0][1].z).toBeCloseTo(0.17);
    expect(onMove.mock.calls[0][2]).toEqual(snap.mock.results[0].value.transform.matrix);
  });
  it("carries the magnetic latch across live frames without committing until release", async () => {
    const { model, onMove, point } = await mount();
    const transform: snapping.MagneticLatch["transform"] = {
      matrix: [1, 0, 0, 4.6, 0, 1, 0, -48, 0, 0, 1, 3.4], contacts: [contact], status: "candidate",
    };
    const latch: snapping.MagneticLatch = { model, id: model.instances[0].id, anchor: { x: 0.23, y: 0, z: 0.17 }, transform };
    const snap = vi.spyOn(snapping, "magneticConstructionTransform").mockReturnValue({ transform, latch });
    pointer("pointerdown", point.x, point.y);
    pointer("pointermove", point.x + 40, point.y + 10);
    flushFrame();
    expect(snap.mock.calls[0][3]).toBeUndefined();
    const preview = observed.scene!.positions.slice();
    pointer("pointermove", point.x + 45, point.y + 10);
    flushFrame();
    expect(snap.mock.calls[1][3]).toBe(latch);
    expect(observed.scene!.positions).toEqual(preview);
    expect(onMove).not.toHaveBeenCalled();
    pointer("pointerup", point.x + 45, point.y + 10);
    expect(onMove).toHaveBeenCalledOnce();
    expect(onMove.mock.calls[0][2]).toEqual(transform.matrix);
  });
  for (const cancellation of ["pointercancel", "lostpointercapture", "multitouch", "project", "blur"]) {
    it(`rolls back ${cancellation} without changing the document`, async () => {
      const { onMove, point, props } = await mount(), original = observed.scene!.positions.slice();
      vi.spyOn(snapping, "magneticConstructionTransform").mockReturnValue({ transform: {
        matrix: [1, 0, 0, 4.6, 0, 1, 0, -48, 0, 0, 1, 3.4], contacts: [contact], status: "candidate",
      } });
      pointer("pointerdown", point.x, point.y);
      pointer("pointermove", point.x + 80, point.y + 10);
      flushFrame();
      expect(observed.scene!.positions).not.toEqual(original);
      expect(element.querySelector("[data-testid='connection-status']")?.textContent).toContain("Magnetisch eingerastet");
      if (cancellation === "multitouch") pointer("pointerdown", point.x - 50, point.y, 2);
      else if (cancellation === "project") await act(async () => { root.render(<BuilderCanvas {...props} projectId="two" imported={undefined} />); });
      else if (cancellation === "blur") act(() => window.dispatchEvent(new Event("blur")));
      else pointer(cancellation, point.x, point.y);
      pointer("pointerup", point.x + 80, point.y + 10);
      expect(onMove).not.toHaveBeenCalled();
      expect(props.onSelect).toHaveBeenCalledTimes(1);
      expect(observed.scene!.positions).toEqual(original);
      expect(element.querySelector("[data-testid='connection-status']")).toBeNull();
    });
  }
  it("refreshes committed markers after edits, history, selection and project changes", async () => {
    const { model, props } = await mount();
    const active = vi.spyOn(snapping, "activeConnections").mockImplementation((current, id) =>
      current.instances[0].matrix[3] === 0 && id === model.instances[0].id ? [{ ...contact, state: "verified" }] : []);
    const changed = { ...model, instances: model.instances.map(i => ({ ...i, matrix: [...i.matrix] as typeof i.matrix })) };
    await act(async () => root.render(<BuilderCanvas {...props} imported={changed} />));
    expect(element.querySelector("[data-testid='connection-status']")?.textContent).toContain("geprüfte Verbindung");
    // Browsers dispatch capture loss after pointerup. No active pointer means
    // the committed selection must keep its verified contacts.
    pointer("lostpointercapture", 0, 0);
    expect(element.querySelector("[data-testid='connection-status']")?.textContent).toContain("geprüfte Verbindung");
    const shifted = { ...changed, instances: changed.instances.map(i => ({ ...i, matrix: [1, 0, 0, 20, 0, 1, 0, 0, 0, 0, 1, 0] as typeof i.matrix })) };
    await act(async () => root.render(<BuilderCanvas {...props} imported={shifted} />));
    expect(element.querySelector("[data-testid='connection-status']")?.textContent).not.toContain("geprüfte Verbindung");
    await act(async () => root.render(<BuilderCanvas {...props} imported={changed} />));
    expect(element.querySelector("[data-testid='connection-status']")?.textContent).toContain("geprüfte Verbindung");
    const button = element.querySelector("[aria-label='Verbindungen anzeigen']")!;
    act(() => button.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(button.getAttribute("aria-pressed")).toBe("false");
    expect(element.querySelector("[data-testid='connection-status']")).toBeNull();
    act(() => button.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(element.querySelector("[data-testid='connection-status']")).not.toBeNull();
    await act(async () => root.render(<BuilderCanvas {...props} imported={changed} selectedId={null} />));
    expect(element.querySelector("[data-testid='connection-status']")).toBeNull();
    expect(active).toHaveBeenCalled();
  });
});
