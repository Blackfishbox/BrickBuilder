// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Box3, Color, DoubleSide, Euler, Group, InstancedMesh, Matrix4, Mesh, MeshLambertMaterial, PerspectiveCamera, Plane, Raycaster, Scene, ShaderMaterial, SRGBColorSpace, Vector2, Vector3 } from "three";
import { engineFixture } from "./engine-fixtures";
import type { SoftwareScene } from "./software-scene";
import * as softwareRendering from "./software-scene";
import * as cameraGestures from "./camera-gesture";
import * as instructionOutlines from "../instructions/outlines";
import { NORMAL_EDGE_CONTRAST, NORMAL_EDGE_WIDTH_PX, THICK_EDGE_WIDTH_PX } from "./wide-lines";
import BuilderCanvas, { FallbackRenderer } from "./BuilderCanvas";
import { constructionArea, createStudGridGeometry, brickConstructionBounds, MAX_STUD_GRID_LINES } from "./construction-floor";
import { instanceIndex } from "./instance-index";
import { compilePart, worldMatrix } from "./ldraw-geometry";
import * as importedScenes from "./imported-scene";
import { DEFAULT_INSTRUCTION_PHI, DEFAULT_INSTRUCTION_THETA } from "./instruction-camera";
import * as snapping from "../connections/engine";
import type { Contact } from "../connections/types";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { gunzipSync } from "fflate";
import { parseLDraw } from "../formats/ldraw/parser";
import type { ImportedModel } from "../formats/types";
import { createEmptyDocument, type Brick, type ToolMode } from "../editor/model";
import { moveImported, tiltImported, placePreparedPart } from "../editor/ldraw-editing";
import type { PreparedPart } from "../editor/ldraw-editing";
import { localPartBounds } from "./stacking";
import { commit, createHistory, redo, undo } from "../editor/history";
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
    forceContextLoss() {}
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
let observedLineWidths: number[];
let observedStrokes: { width: number; color: string }[], contextLineWidth: number, contextStrokeStyle: string;
let observedPaints: { fillStyle: string; globalAlpha: number }[], contextFillStyle: string, contextGlobalAlpha: number;
const context = new Proxy({}, {
  get: (_target, key) => key === "fill"
    ? vi.fn(() => observedPaints.push({ fillStyle: contextFillStyle, globalAlpha: contextGlobalAlpha }))
    : key === "stroke"
      ? vi.fn(() => observedStrokes.push({ width: contextLineWidth, color: contextStrokeStyle }))
    : vi.fn(),
  set: (_target, key, value) => {
    if (key === "lineWidth") { observedLineWidths.push(value as number); contextLineWidth = value as number; }
    if (key === "strokeStyle") contextStrokeStyle = value as string;
    if (key === "fillStyle") contextFillStyle = value as string;
    if (key === "globalAlpha") contextGlobalAlpha = value as number;
    return true;
  },
});
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
  observedLineWidths = [];
  observedStrokes = []; contextLineWidth = 1; contextStrokeStyle = "";
  observedPaints = []; contextFillStyle = ""; contextGlobalAlpha = 1;
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

it.each([false, true])("tries historical WebGL before software and rebuilds it (thick edges: %s)", async (thickEdges) => {
  observed.webglEnabled = true;
  const model = engineFixture(1, 3);
  const props = { projectId: "graphics-recovery", bricks: [], imported: model, selectedId: null,
    selectedType: "brick-2x4" as const, selectedColor: "#B40000", toolMode: "view" as const,
    onMove: vi.fn(), onSelect: vi.fn(), onPlace: vi.fn() };
  const gpuCanvas = () => element.querySelector<HTMLCanvasElement>("[data-renderer='webgl']")!;
  const edges = () => observed.scene3d?.getObjectByName("ldraw:instanced-edges");
  const waitForModel = async () => {
    await act(async () => {
      await vi.waitFor(() => expect(observed.scene3d?.children.some(child => instanceIndex(child as Group))).toBe(true));
    });
    flushFrame();
  };
  act(() => root.render(<BuilderCanvas {...props} thickEdges={!thickEdges} />));
  await waitForModel();
  act(() => root.render(<BuilderCanvas {...props} thickEdges={thickEdges} />));
  flushFrame();
  expect((edges() as Mesh<never, ShaderMaterial>).material.uniforms.edgeContrast.value)
    .toBe(thickEdges ? 1 : NORMAL_EDGE_CONTRAST);
  const initialCamera = observed.cameraPose;
  const first = gpuCanvas();
  act(() => { first.dispatchEvent(new Event("webglcontextlost", { cancelable: true })); });
  await waitForModel();
  const second = gpuCanvas();
  expect(second).not.toBe(first);
  expect(first.isConnected).toBe(false);
  expect(observed.preparations).toBe(0);
  expect(observed.cameraPose).toEqual(initialCamera);
  expect(second.dataset.webglProfile).toBe("legacy");
  expect(edges()?.userData.legacyEdges).toBe(true);
  expect((edges() as Mesh<never, ShaderMaterial>).material.uniforms.lineWidth.value).toBe(thickEdges ? 18 : 1);
  expect(vi.mocked(HTMLCanvasElement.prototype.getContext).mock.calls.filter(([kind]) => kind === "webgl2").at(-1))
    .toEqual(["webgl2", expect.objectContaining({ antialias: false })]);

  act(() => { second.dispatchEvent(new Event("webglcontextlost", { cancelable: true })); });
  await waitForModel();
  const third = gpuCanvas();
  expect(third).not.toBe(second);
  expect(third.dataset.webglProfile).toBe("legacy-faces");
  expect(edges()).toBeUndefined();
  expect(observed.preparations).toBe(0);

  act(() => { third.dispatchEvent(new Event("webglcontextlost", { cancelable: true })); });
  await act(async () => {
    await vi.waitFor(() => expect(observed.scene).toBeDefined());
  });
  expect(element.querySelector("[data-renderer='canvas-fallback']")).not.toBeNull();
  const retry = [...element.querySelectorAll("button")].find(button => button.textContent === "Darstellung neu aufbauen")!;
  expect(retry).toBeDefined();
  act(() => retry.click());
  await waitForModel();
  expect(gpuCanvas()).not.toBe(third);
  expect(gpuCanvas().dataset.webglProfile).toBe("legacy");
  expect(edges()?.userData.legacyEdges).toBe(true);
  expect(element.querySelector("[data-renderer='canvas-fallback']")).toBeNull();
  expect(observed.cameraPose).toEqual(initialCamera);
});

it("tries the historical WebGL scene when the modern scene exceeds its GPU budget", async () => {
  observed.webglEnabled = true;
  const original = importedScenes.createImportedGroupAsync;
  const build = vi.spyOn(importedScenes, "createImportedGroupAsync").mockImplementation((model, options) =>
    options?.viewport === "standard" ? Promise.reject(new importedScenes.SceneBudgetExceeded()) : original(model, options));
  const model = engineFixture(1, 3);
  act(() => root.render(<BuilderCanvas projectId="gpu-budget-test" imported={model} bricks={[]} selectedId={null}
    selectedType="brick-2x4" selectedColor="#B40000" toolMode="view" onMove={vi.fn()} onSelect={vi.fn()} onPlace={vi.fn()} />));
  for (const profile of ["standard", "legacy"]) {
    await act(async () => {
      await vi.waitFor(() => expect(build.mock.calls.some(([, options]) => options?.viewport === profile)).toBe(true));
    });
  }
  await act(async () => {
    await vi.waitFor(() => expect(observed.scene3d?.getObjectByName("ldraw:instanced-edges")?.userData.legacyEdges).toBe(true));
  });
  expect(element.querySelector("[data-webgl-profile='legacy']")).not.toBeNull();
  expect(observed.preparations).toBe(0);
});

describe("temporary rotation anchor marker", () => {
  for (const webgl of [true, false]) {
    it(`tracks selection and stays outside model geometry in ${webgl ? "WebGL" : "compatibility"} mode`, async () => {
      observed.webglEnabled = webgl;
      const model = engineFixture(1, 3);
      const anchor: [number, number, number] = [1, 0, 0];
      const props = {
        projectId: `rotation-anchor-marker-${webgl}`,
        bricks: [], imported: model, selectedId: model.instances[0].id, selectedRotationAnchor: anchor,
        selectedType: "brick-2x4" as const, selectedColor: "#B40000", toolMode: "select" as const,
        onMove: vi.fn(), onSelect: vi.fn(), onPlace: vi.fn(),
      };
      act(() => root.render(<BuilderCanvas {...props} />));
      host = element.querySelector("[data-testid='canvas-3d']")!;
      await act(async () => {
        await vi.waitFor(() => expect(webgl
          ? observed.scene3d?.children.some(child => instanceIndex(child as Group))
          : observed.scene).toBeTruthy());
      });
      flushFrame();

      const marker = element.querySelector<HTMLElement>("[data-testid='rotation-anchor-marker']")!;
      expect(marker.style.display).toBe("grid");
      expect(Number.isFinite(Number.parseFloat(marker.style.left))).toBe(true);
      expect(Number.isFinite(Number.parseFloat(marker.style.top))).toBe(true);
      expect(marker.style.pointerEvents).toBe("none");
      const modelRoot = webgl ? observed.scene3d!.children.find(child => instanceIndex(child as Group)) as Group : null;
      const importOffset = modelRoot?.position.y ?? Math.max(0, -observed.scene!.bounds.min.y);
      const expectedPoint = new Vector3(...anchor)
        .applyMatrix4(worldMatrix(model.instances[0].matrix));
      expectedPoint.y += importOffset;
      expectedPoint.project(observed.camera!);
      expect(Number.parseFloat(marker.style.left)).toBeCloseTo((expectedPoint.x + 1) * 300, 4);
      expect(Number.parseFloat(marker.style.top)).toBeCloseTo((1 - expectedPoint.y) * 300, 4);
      const initialPosition = { left: marker.style.left, top: marker.style.top };
      if (webgl) {
        expect(observed.scene3d!.children.some(child => child.name === "rotation-anchor-marker")).toBe(false);
      }

      act(() => root.render(<BuilderCanvas {...props} selectedRotationAnchor={[2, 0, 0]} />));
      flushFrame();
      const changedPosition = { left: marker.style.left, top: marker.style.top };
      expect(changedPosition).not.toEqual(initialPosition);
      act(() => root.render(<BuilderCanvas {...props} selectedRotationAnchor={null} />));
      flushFrame();
      expect(marker.style.display).toBe("none");

      act(() => root.render(<BuilderCanvas {...props} selectedRotationAnchor={anchor} selectedId={null} />));
      flushFrame();
      expect(marker.style.display).toBe("none");
      expect(changedPosition.left).not.toBe("");
      expect(changedPosition.top).not.toBe("");
    });
  }
});

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

function transformedPartBoxBounds(model: ImportedModel, instance: ImportedModel["instances"][number]): Box3 {
  const bounds = new Box3(), point = new Vector3();
  for (const surface of compilePart(model, instance.reference, "16")) {
    for (const positions of [surface.positions, surface.edges]) {
      for (let index = 0; index < positions.length; index += 3) {
        bounds.expandByPoint(point.fromArray(positions, index));
      }
    }
  }
  return bounds.applyMatrix4(worldMatrix(instance.matrix));
}

function importedTiltTransform(
  position: Vector3,
  angles: readonly [number, number, number],
  mirrored: boolean,
): Affine {
  const world = new Matrix4().makeRotationFromEuler(new Euler(
    angles[0] * Math.PI / 180, angles[1] * Math.PI / 180, angles[2] * Math.PI / 180, "XYZ",
  ));
  if (mirrored) world.multiply(new Matrix4().makeScale(-1, 1, 1));
  world.setPosition(position);
  // Imported matrices use LDraw's Y-down coordinates and LDU translations.
  const yFlip = new Matrix4().makeScale(1, -1, 1);
  const source = yFlip.clone().multiply(world).multiply(yFlip);
  const matrix = affine(source);
  matrix[3] *= 20; matrix[7] *= 20; matrix[11] *= 20;
  return matrix;
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

it("toggles screen-space edge width without rebuilding imported or local model geometry", async () => {
  observed.webglEnabled = true;
  const imported = engineFixture(1, 1);
  const brick: Brick = { id: "local-edge", type: "brick-2x2", color: "#B40000", x: 3, y: 0, z: 0, rotation: 0 };
  const props = { projectId: "thick-edges", bricks: [brick], imported, selectedId: null,
    selectedType: "brick-2x2" as const, selectedColor: "#B40000", toolMode: "view" as const,
    onMove: vi.fn(), onSelect: vi.fn(), onPlace: vi.fn(), thickEdges: false };
  await act(async () => root.render(<BuilderCanvas {...props} />));
  await act(async () => {
    await vi.waitFor(() => {
      const modelRoot = observed.scene3d?.children.find(child => instanceIndex(child as Group)) as Group | undefined;
      expect(modelRoot?.getObjectByName("ldraw:instanced-edges")).toBeDefined();
    });
  });
  flushFrame();

  const modelRoot = observed.scene3d!.children.find(child => instanceIndex(child as Group)) as Group;
  const importedEdge = modelRoot.getObjectByName("ldraw:instanced-edges") as Mesh;
  const localEdge = observed.scene3d!.getObjectByName("brick-edges-brick-2x2") as Mesh;
  const importedGeometry = importedEdge.geometry;
  const localGeometry = localEdge.geometry;
  const edgeMaterial = importedEdge.material as ShaderMaterial;
  expect(importedEdge.geometry.getAttribute("lineEnd").count).toBeGreaterThan(0);
  expect(edgeMaterial.side).toBe(DoubleSide);
  expect(edgeMaterial.depthTest).toBe(true);
  expect(edgeMaterial.transparent).toBe(true);
  expect(importedEdge.renderOrder).toBeGreaterThan(0);
  expect(edgeMaterial.uniforms.lineWidth.value).toBe(NORMAL_EDGE_WIDTH_PX);
  expect(importedEdge.geometry.getAttribute("instanceEdgeColor").count).toBe(imported.instances.length);
  expect(importedEdge.geometry.getAttribute("edgeNormal").count).toBe(
    importedEdge.geometry.getAttribute("position").count,
  );
  expect(importedEdge.geometry.getAttribute("edgeAlternateNormal").count).toBe(
    importedEdge.geometry.getAttribute("position").count,
  );
  expect(importedEdge.geometry.getAttribute("edgeBaseColor").count).toBe(
    importedEdge.geometry.getAttribute("position").count,
  );
  expect([...importedEdge.geometry.getAttribute("edgeUseInstanceColor").array]).toContain(1);
  expect([...importedEdge.geometry.getAttribute("edgeUseInstanceColor").array]).toContain(0);
  const originalEdgeColor = [...importedEdge.geometry.getAttribute("instanceEdgeColor").array];
  expect(localEdge.visible).toBe(true);
  expect(edgeMaterial.uniforms.edgeContrast.value).toBe(NORMAL_EDGE_CONTRAST);
  expect(edgeMaterial.uniforms.blackLineWidth.value).toBe(0);

  await act(async () => root.render(<BuilderCanvas {...props} thickEdges />));
  flushFrame();
  expect(THICK_EDGE_WIDTH_PX).toBe(5.5);
  expect(edgeMaterial.uniforms.lineWidth.value).toBe(THICK_EDGE_WIDTH_PX);
  expect(edgeMaterial.uniforms.edgeContrast.value).toBe(1);
  expect(edgeMaterial.uniforms.blackLineWidth.value).toBe(NORMAL_EDGE_WIDTH_PX);
  expect(edgeMaterial.uniforms.lineWidth.value).toBeGreaterThan(1);
  expect(edgeMaterial.uniforms.lineWidth.value).toBeLessThan(7);
  expect([...importedEdge.geometry.getAttribute("instanceEdgeColor").array]).toEqual(originalEdgeColor);
  expect(edgeMaterial.fragmentShader).toContain("vec3 baseColor = mix(vEdgeColor, vInstanceEdgeColor, vEdgeUseInstanceColor);");
  expect(edgeMaterial.fragmentShader).toContain("smoothstep(1.0 - edgeWidth, 1.0, abs(vLineSide))");
  expect(edgeMaterial.vertexShader).toContain("vec4 clip = clipA;");
  expect(edgeMaterial.vertexShader).toContain("clip.z -= 0.000002 * clip.w;");
  expect(edgeMaterial.vertexShader).not.toContain("mix(clipA, clipB, lineEndpoint)");
  expect(localEdge.visible).toBe(true);
  expect(localEdge.renderOrder).toBeGreaterThan(0);
  expect(importedEdge.visible).toBe(true);
  expect(importedEdge.geometry).toBe(importedGeometry);
  expect(localEdge.geometry).toBe(localGeometry);
  const transformRows = importedEdge.geometry.getAttribute("instanceRow0");
  const beforeMove = transformRows.array[3];
  const moved = [...imported.instances[0].matrix] as Affine;
  moved[3] += 40;
  instanceIndex(modelRoot)!.preview(imported.instances[0].id, moved);
  expect(transformRows.array[3]).not.toBe(beforeMove);
  await act(async () => root.render(<BuilderCanvas {...props} thickEdges darkMode />));
  flushFrame();
  expect([...importedEdge.geometry.getAttribute("instanceEdgeColor").array]).toEqual(originalEdgeColor);

  await act(async () => root.render(<BuilderCanvas {...props} />));
  flushFrame();
  expect(edgeMaterial.uniforms.lineWidth.value).toBe(NORMAL_EDGE_WIDTH_PX);
  expect(edgeMaterial.uniforms.edgeContrast.value).toBe(NORMAL_EDGE_CONTRAST);
  expect(edgeMaterial.uniforms.blackLineWidth.value).toBe(0);
  expect(localEdge.visible).toBe(true);
});

it("draws the enabled thick edges on the current local brick preview", async () => {
  observed.webglEnabled = true;
  const props = {
    projectId: "thick-edge-preview", bricks: [], imported: undefined, selectedId: null,
    selectedType: "brick-2x2" as const, selectedColor: "#B40000", toolMode: "build" as const,
    onMove: vi.fn(), onSelect: vi.fn(), onPlace: vi.fn(), thickEdges: true,
  };
  await act(async () => root.render(<BuilderCanvas {...props} />));
  flushFrame();

  const preview = observed.scene3d!.getObjectByName("placement-preview") as Mesh;
  const edges = preview.getObjectByName("brick-edges-brick-2x2") as Mesh;
  expect(edges).toBeDefined();
  expect(edges.visible).toBe(true);
  expect(edges.geometry.getAttribute("instanceEdgeColor").array).toHaveLength(3);
  expect(edges.geometry.getAttribute("edgeNormal").count).toBe(edges.geometry.getAttribute("position").count);
  expect(edges.geometry.getAttribute("edgeAlternateNormal").count).toBe(edges.geometry.getAttribute("position").count);
  expect((edges.material as ShaderMaterial).transparent).toBe(true);
  expect((edges.material as ShaderMaterial).uniforms.lineWidth.value).toBe(THICK_EDGE_WIDTH_PX);
  expect((preview.material as MeshLambertMaterial).opacity).toBe(1);
  expect((preview.material as MeshLambertMaterial).transparent).toBe(false);
  const previewColor = edges.geometry.getAttribute("instanceEdgeColor").array;
  const faceColor = new Color("#B40000");
  const encoded = faceColor.getHex(SRGBColorSpace);
  expect(previewColor[0] / 255).toBeCloseTo(((encoded >> 16) & 0xff) / 255);
  expect(previewColor[1] / 255).toBeCloseTo(((encoded >> 8) & 0xff) / 255);
  expect(previewColor[2] / 255).toBeCloseTo((encoded & 0xff) / 255);
});

it("draws bounded thicker source edges in the compatibility renderer", async () => {
  const model = engineFixture(1, 1);
  const software = await softwareRendering.createSoftwareScene(model);
  expect([...software.records.values()].some(record => record.localEdges.length > 0)).toBe(true);
  const record = [...software.records.values()][0];
  expect(record.localEdgeColorCodes).toContain("16");
  expect(record.localEdgeColorCodes).toContain("2");
  expect(record.localEdgeNormals).toHaveLength(record.localEdges.length);
  expect(software.edgeRecords.length).toBeLessThanOrEqual(software.records.size);
  const local: Brick = { id: "compat-local", type: "brick-2x2", color: "#B40000", x: 0, y: 0, z: 0, rotation: 0 };
  const renderer = new FallbackRenderer();
  renderer.setSize(600, 600);
  const camera = new PerspectiveCamera(42, 1, 0.1, 4000);
  camera.position.set(10, 10, 10);
  camera.lookAt(0, 0, 0);
  renderer.render(camera, new Vector3(), [local], null, software, 0, false, undefined,
    constructionArea(new Box3()), false, null, null, true);
  expect(observedLineWidths).toContain(THICK_EDGE_WIDTH_PX);
  expect(observedStrokes.some(stroke => stroke.width === NORMAL_EDGE_WIDTH_PX && stroke.color === "#000000")).toBe(true);
  expect(observedStrokes.some(stroke =>
    stroke.width === THICK_EDGE_WIDTH_PX && stroke.color.startsWith("rgb(") && stroke.color !== "#B40000",
  )).toBe(true);
  expect(observedPaints.some(item => item.globalAlpha === 1 && item.fillStyle.startsWith("rgb("))).toBe(true);
  expect(software.records.size).toBe(1);
});

it("draws thin black standard edges without changing opaque part faces", () => {
  const local: Brick = { id: "black-edge-local", type: "brick-2x2", color: "#B40000", x: 0, y: 0, z: 0, rotation: 0 };
  const renderer = new FallbackRenderer();
  renderer.setSize(600, 600);
  const camera = new PerspectiveCamera(42, 1, 0.1, 4000);
  camera.position.set(10, 10, 10);
  camera.lookAt(0, 0, 0);
  renderer.render(camera, new Vector3(), [local], null);
  expect(NORMAL_EDGE_CONTRAST).toBe(0);
  expect(observedStrokes.some(stroke => stroke.width === NORMAL_EDGE_WIDTH_PX && stroke.color === "rgb(0,0,0)")).toBe(true);
  expect(observedPaints.some(paint => paint.globalAlpha === 1 && paint.fillStyle !== "rgb(0,0,0)")).toBe(true);
});

it("outlines every selected local part in the compatibility renderer", () => {
  const bricks: Brick[] = [
    { id: "outline-first", type: "brick-2x2", color: "#B40000", x: 0, y: 0, z: 0, rotation: 0 },
    { id: "outline-second", type: "brick-1x2", color: "#1E5AA8", x: 5, y: 0, z: 0, rotation: 0 },
  ];
  const renderer = new FallbackRenderer();
  renderer.setSize(600, 600);
  const camera = new PerspectiveCamera(42, 1, 0.1, 4000);
  camera.position.set(10, 10, 10);
  camera.lookAt(0, 0, 0);
  renderer.render(camera, new Vector3(), bricks, bricks[0].id, undefined, 0, false, undefined,
    constructionArea(new Box3()), false, null, null, false, bricks.map(brick => brick.id));
  expect(observedStrokes.filter(stroke => stroke.color === "#b84e37")).toHaveLength(2);
});

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

    it(`combines and restores the floor for local and imported parts in ${rendererName}`, async () => {
      observed.webglEnabled = webgl;
      const model = engineFixture(1, 3);
      const importedAt = (source: ImportedModel, x: number, z: number): ImportedModel => ({
        ...source,
        instances: source.instances.map(instance => ({
          ...instance,
          matrix: [...instance.matrix.slice(0, 3), x * 20, ...instance.matrix.slice(4, 11), z * 20] as Affine,
        })),
      });
      const localAt = (x: number, z = 0): Brick => ({
        id: "mixed-local", type: "brick-2x4", color: "#B40000", x, y: 0, z, rotation: 0,
      });
      const expectedBounds = (bricks: Brick[], imported?: ImportedModel) => {
        const bounds = bricks.reduce(
          (result, brick) => result.union(brickConstructionBounds(brick)),
          new Box3(),
        );
        for (const instance of imported?.instances ?? []) {
          bounds.union(transformedPartBounds(imported!, instance));
        }
        return bounds;
      };
      const props = { projectId: `mixed-floor-${rendererName}`, bricks: [localAt(120)], imported: model,
        selectedId: null, selectedType: "brick-2x4" as const, selectedColor: "#B40000",
        toolMode: "select" as const, onMove: vi.fn(), onSelect: vi.fn(), onPlace: vi.fn() };
      const renderStep = async (bricks: Brick[], imported?: ImportedModel) => {
        await act(async () => root.render(<BuilderCanvas {...props} bricks={bricks} imported={imported} />));
        flushFrame();
        expectConstructionArea(expectedBounds(bricks, imported));
      };

      await renderStep(props.bricks, model);
      await renderStep([localAt(-160)], model);
      await renderStep([], model);

      const movedLocal = [localAt(190, -120)];
      await renderStep(movedLocal, model);
      const movedImported = importedAt(model, -260, 180);
      await renderStep(movedLocal, movedImported);
      await renderStep(movedLocal, undefined);
    });

    it(`keeps tilted and mirrored imported bounds current in ${rendererName}`, async () => {
      observed.webglEnabled = webgl;
      const model = engineFixture(1, 1);
      model.resources["parts/test.dat"].content =
        "3 16 -40 -10 -10 40 -10 -10 -20 30 30\n2 24 -40 -10 -10 40 -10 -10";
      const props = { projectId: `tilted-floor-${rendererName}`, bricks: [], imported: model, selectedId: null,
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
      const originalBounds = currentImportedBounds(webgl).clone();

      const transformed = (position: Vector3, angles: readonly [number, number, number], mirrored: boolean) => ({
        ...model.instances[0], id: "transformed",
        matrix: importedTiltTransform(position, angles, mirrored),
      });
      const renderStep = async (next: ImportedModel, changed?: ImportedModel["instances"][number]) => {
        await act(async () => root.render(<BuilderCanvas {...props} imported={next} />));
        flushFrame();

        const expectedBounds = next.instances.reduce(
          (bounds, instance) => bounds.union(transformedPartBoxBounds(next, instance)),
          new Box3(),
        );
        const actualBounds = currentImportedBounds(webgl);
        expect(actualBounds.min.x).toBeCloseTo(expectedBounds.min.x, 3);
        expect(actualBounds.max.x).toBeCloseTo(expectedBounds.max.x, 3);
        expect(actualBounds.min.y).toBeCloseTo(expectedBounds.min.y, 3);
        expect(actualBounds.max.y).toBeCloseTo(expectedBounds.max.y, 3);
        expect(actualBounds.min.z).toBeCloseTo(expectedBounds.min.z, 3);
        expect(actualBounds.max.z).toBeCloseTo(expectedBounds.max.z, 3);
        expectConstructionArea(actualBounds);
        if (changed) {
          const expectedPart = transformedPartBoxBounds(next, changed);
          const actualPart = currentImportedInstanceBounds(changed.id, webgl);
          expect(actualPart.min.x).toBeCloseTo(expectedPart.min.x, 3);
          expect(actualPart.max.x).toBeCloseTo(expectedPart.max.x, 3);
          expect(actualPart.min.z).toBeCloseTo(expectedPart.min.z, 3);
          expect(actualPart.max.z).toBeCloseTo(expectedPart.max.z, 3);
          const area = constructionArea(actualBounds);
          expect(area.minX).toBeLessThanOrEqual(actualPart.min.x);
          expect(area.maxX).toBeGreaterThanOrEqual(actualPart.max.x);
          expect(area.minZ).toBeLessThanOrEqual(actualPart.min.z);
          expect(area.maxZ).toBeGreaterThanOrEqual(actualPart.max.z);
        }
        expectCameraPose(camera);
      };

      const tilted = transformed(new Vector3(90, 12, -70), [38, 0, -27], false);
      const added = { ...model, instances: [...model.instances, tilted] };
      await renderStep(added, tilted);

      const tiltedAndMirrored = transformed(new Vector3(-150, -8, 130), [-31, 19, 42], true);
      const moved = { ...added, instances: added.instances.map(instance =>
        instance.id === "transformed" ? tiltedAndMirrored : instance) };
      await renderStep(moved, tiltedAndMirrored);

      await renderStep({ ...moved, instances: moved.instances.filter(instance => instance.id !== "transformed") });
      const restoredBounds = currentImportedBounds(webgl);
      expect(restoredBounds.min.x).toBeCloseTo(originalBounds.min.x, 3);
      expect(restoredBounds.max.x).toBeCloseTo(originalBounds.max.x, 3);
      expect(restoredBounds.min.y).toBeCloseTo(originalBounds.min.y, 3);
      expect(restoredBounds.max.y).toBeCloseTo(originalBounds.max.y, 3);
      expect(restoredBounds.min.z).toBeCloseTo(originalBounds.min.z, 3);
      expect(restoredBounds.max.z).toBeCloseTo(originalBounds.max.z, 3);
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
  it("replaces suggestions with icon toggles and announces their current state", () => {
    const props = { bricks: [], selectedId: null, selectedType: "brick-1x2" as const, selectedColor: "#fff",
      toolMode: "select" as const, onMove: vi.fn(), onSelect: vi.fn(), onPlace: vi.fn() };
    act(() => root.render(<BuilderCanvas {...props} />));
    expect(element.querySelector("[aria-label='Verbindungsvorschau anzeigen']")).toBeNull();
    expect(element.querySelector("[data-testid='connection-preview-range']")).toBeNull();
    for (const [label, name, initial] of [
      ["Kollisionswarnung anzeigen", "Kollisionswarnung", false],
      ["Schwebewarnung anzeigen", "Schwebewarnung", false],
      ["Verbindungen anzeigen", "Verbindungen", true],
    ] as const) {
      const toggle = element.querySelector<HTMLButtonElement>(`[aria-label='${label}']`)!;
      expect(toggle.classList.contains("canvas-control-toggle")).toBe(true);
      expect(toggle.textContent).toBe("");
      expect(toggle.querySelector("svg")).not.toBeNull();
      expect(toggle.getAttribute("aria-pressed")).toBe(String(initial));
      act(() => toggle.click());
      expect(element.querySelector("[data-testid='construction-toggle-toast']")?.textContent).toBe(`${name} ${initial ? "inaktiv" : "aktiv"}`);
      act(() => toggle.click());
      expect(toggle.getAttribute("aria-pressed")).toBe(String(initial));
      expect(element.querySelector("[data-testid='construction-toggle-toast']")?.textContent).toBe(`${name} ${initial ? "aktiv" : "inaktiv"}`);
    }
  });
  it("defaults connected upper-part movement on and shows its state when toggled", () => {
    const props = { bricks: [], selectedId: null, selectedType: "brick-1x2" as const, selectedColor: "#fff",
      toolMode: "select" as const, onMove: vi.fn(), onSelect: vi.fn(), onPlace: vi.fn() };
    act(() => root.render(<BuilderCanvas {...props} />));

    const toggle = element.querySelector<HTMLButtonElement>("[data-testid='button-move-connected-above']")!;
    expect(toggle).not.toBeNull();
    expect(toggle.getAttribute("aria-label")).toBe("Verbundene obere Teile mitbewegen");
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    expect(toggle.querySelector("svg")).not.toBeNull();

    act(() => toggle.click());
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    expect(element.querySelector("[data-testid='construction-toggle-toast']")?.textContent)
      .toBe("Verbundene obere Teile bleiben stehen");

    act(() => root.render(<BuilderCanvas {...props} toolMode="build" />));
    expect(element.querySelector("[data-testid='button-move-connected-above']")).toBeNull();
    act(() => root.render(<BuilderCanvas {...props} toolMode="view" />));
    expect(element.querySelector("[data-testid='button-move-connected-above']")).toBeNull();
  });
  it("defaults direct multi-selection off and toggles selected parts from canvas taps when enabled", async () => {
    const { props, point, model } = await mount("select");
    const toggle = element.querySelector<HTMLButtonElement>("[data-testid='button-multiselect-on-tap']")!;
    expect(toggle).not.toBeNull();
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    expect(toggle.querySelector("svg")).not.toBeNull();

    act(() => toggle.click());
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    expect(element.querySelector("[data-testid='construction-toggle-toast']")?.textContent)
      .toBe("Direkte Mehrfachauswahl aktiv: Teile antippen zum Hinzufügen oder Entfernen");

    pointer("pointerdown", point.x, point.y);
    pointer("pointerup", point.x, point.y);
    expect(props.onToggleSelection).toHaveBeenCalledWith(model.instances[0].id);
    expect(props.onSelect).not.toHaveBeenCalled();
  });
  it("keeps icon toggle gestures from starting a canvas camera gesture", async () => {
    await mount("select");
    const toggle = element.querySelector<HTMLButtonElement>("[aria-label='Kollisionswarnung anzeigen']")!;
    const capturePointer = vi.mocked(host.setPointerCapture);
    capturePointer.mockClear();

    pointerOn(toggle, "pointerdown", 120, 150);
    pointerOn(toggle, "pointermove", 180, 150);
    pointerOn(toggle, "pointerup", 180, 150);

    expect(capturePointer).not.toHaveBeenCalled();

    const connectedToggle = element.querySelector<HTMLButtonElement>("[data-testid='button-move-connected-above']")!;
    pointerOn(connectedToggle, "pointerdown", 120, 150);
    pointerOn(connectedToggle, "pointermove", 180, 150);
    pointerOn(connectedToggle, "pointerup", 180, 150);
    expect(capturePointer).not.toHaveBeenCalled();
  });
  it("shows collisions on demand and recalculates after moving and deleting parts", async () => {
    const brick: Brick = { id: "a", type: "brick-1x2", color: "#fff", x: 0, y: 0, z: 0, rotation: 0 };
    const props = { bricks: [brick, { ...brick, id: "b" }], selectedId: null, selectedType: "brick-1x2" as const,
      selectedColor: "#fff", toolMode: "select" as const, onMove: vi.fn(), onSelect: vi.fn(), onPlace: vi.fn() };
    act(() => root.render(<BuilderCanvas {...props} />));
    expect(element.querySelector("[data-testid='collision-warning']")).toBeNull();
    await act(async () => element.querySelector<HTMLButtonElement>("[aria-label='Kollisionswarnung anzeigen']")!.click());
    expect(element.querySelector("[data-testid='collision-warning']")?.textContent).toContain("2 Teile kollidieren");
    await act(async () => root.render(<BuilderCanvas {...props} bricks={[brick, { ...brick, id: "b", x: 10 }]} />));
    expect(element.querySelector("[data-testid='collision-warning']")?.textContent).toBe("Keine Kollisionen erkannt");
    await act(async () => root.render(<BuilderCanvas {...props} bricks={[brick]} />));
    expect(element.querySelector("[data-testid='collision-warning']")?.textContent).toBe("Keine Kollisionen erkannt");
    act(() => element.querySelector<HTMLButtonElement>("[aria-label='Kollisionswarnung anzeigen']")!.click());
    expect(element.querySelector("[data-testid='collision-warning']")).toBeNull();
  });
  it("shows worker progress and ignores stale progress after model changes or disabling", () => {
    const workers: {
      onmessage: ((event: MessageEvent) => void) | null;
      terminated: boolean;
    }[] = [];
    class WorkerStub {
      onmessage: ((event: MessageEvent) => void) | null = null;
      onerror: ((event: ErrorEvent) => void) | null = null;
      onmessageerror: (() => void) | null = null;
      terminated = false;
      constructor() { workers.push(this); }
      postMessage() {}
      terminate() { this.terminated = true; }
    }
    vi.stubGlobal("Worker", WorkerStub);
    const props = { bricks: [], selectedId: null, selectedType: "brick-1x2" as const, selectedColor: "#fff",
      toolMode: "select" as const, onMove: vi.fn(), onSelect: vi.fn(), onPlace: vi.fn() };
    act(() => root.render(<BuilderCanvas {...props} />));
    const toggle = element.querySelector<HTMLButtonElement>("[aria-label='Kollisionswarnung anzeigen']")!;
    act(() => toggle.click());
    expect(workers).toHaveLength(1);

    const sendProgress = (worker: typeof workers[number], percent: number) => {
      act(() => worker.onmessage?.({ data: { progress: { phase: "checking", percent } } } as MessageEvent));
    };
    sendProgress(workers[0], 42);
    expect(element.querySelector("[data-testid='collision-warning']")?.textContent).toContain("42 %");
    expect(element.querySelector<HTMLProgressElement>("progress[aria-label='Fortschritt der Kollisionsprüfung']")?.value).toBe(42);

    act(() => root.render(<BuilderCanvas {...props} bricks={[{ id: "new", type: "brick-1x2", color: "#fff", x: 0, y: 0, z: 0, rotation: 0 }]} />));
    expect(workers).toHaveLength(2);
    expect(workers[0].terminated).toBe(true);
    sendProgress(workers[0], 91);
    expect(element.querySelector("[data-testid='collision-warning']")?.textContent).toContain("0 %");
    sendProgress(workers[1], 18);
    expect(element.querySelector("[data-testid='collision-warning']")?.textContent).toContain("18 %");

    act(() => toggle.click());
    expect(element.querySelector("[data-testid='collision-warning']")).toBeNull();
    expect(workers[1].terminated).toBe(true);
    act(() => toggle.click());
    expect(workers).toHaveLength(3);
    expect(element.querySelector("[data-testid='collision-warning']")?.textContent).toContain("0 %");
    sendProgress(workers[1], 99);
    expect(element.querySelector("[data-testid='collision-warning']")?.textContent).toContain("0 %");
  });
  it("clears worker progress after failure and ignores later messages from that worker", async () => {
    const workers: {
      onmessage: ((event: MessageEvent) => void) | null;
      terminated: boolean;
    }[] = [];
    class WorkerStub {
      onmessage: ((event: MessageEvent) => void) | null = null;
      onerror: ((event: ErrorEvent) => void) | null = null;
      onmessageerror: (() => void) | null = null;
      terminated = false;
      constructor() { workers.push(this); }
      postMessage() {}
      terminate() { this.terminated = true; }
    }
    vi.stubGlobal("Worker", WorkerStub);
    const props = { bricks: [], selectedId: null, selectedType: "brick-1x2" as const, selectedColor: "#fff",
      toolMode: "select" as const, onMove: vi.fn(), onSelect: vi.fn(), onPlace: vi.fn() };
    act(() => root.render(<BuilderCanvas {...props} />));
    act(() => element.querySelector<HTMLButtonElement>("[aria-label='Kollisionswarnung anzeigen']")!.click());
    expect(workers).toHaveLength(1);

    const worker = workers[0];
    act(() => worker.onmessage?.({
      data: { progress: { phase: "checking", percent: 42 } },
    } as MessageEvent));
    expect(element.querySelector<HTMLProgressElement>("progress[aria-label='Fortschritt der Kollisionsprüfung']")?.value).toBe(42);

    await act(async () => {
      worker.onmessage?.({
        data: { error: { name: "Error", message: "simulated worker failure" } },
      } as MessageEvent);
    });
    expect(worker.terminated).toBe(true);
    expect(element.querySelector("[data-testid='collision-warning']")?.textContent).toBe("Kollisionsprüfung nicht abgeschlossen");
    expect(element.querySelector("progress[aria-label='Fortschritt der Kollisionsprüfung']")).toBeNull();

    act(() => worker.onmessage?.({
      data: { progress: { phase: "checking", percent: 91 } },
    } as MessageEvent));
    expect(element.querySelector("[data-testid='collision-warning']")?.textContent).toBe("Kollisionsprüfung nicht abgeschlossen");
    expect(element.querySelector("progress[aria-label='Fortschritt der Kollisionsprüfung']")).toBeNull();
  });
  it("can hide the construction status controls while another overlay is open", () => {
    const props = { bricks: [], selectedId: null, selectedType: "brick-1x2" as const, selectedColor: "#fff",
      toolMode: "select" as const, onMove: vi.fn(), onSelect: vi.fn(), onPlace: vi.fn(), showConstructionControls: false };
    act(() => root.render(<BuilderCanvas {...props} />));
    expect(element.querySelector("[data-testid='construction-controls']")).toBeNull();
    expect(element.querySelector("[aria-label='Verbindungen anzeigen']")).toBeNull();
    expect(element.querySelector("[aria-label='Verbindungsvorschau anzeigen']")).toBeNull();
    expect(element.querySelector("[aria-label='Kollisionswarnung anzeigen']")).toBeNull();
    expect(element.querySelector("[aria-label='Schwebewarnung anzeigen']")).toBeNull();
  });
  it("hides construction controls in view-only mode", () => {
    const props = { bricks: [], selectedId: null, selectedType: "brick-1x2" as const, selectedColor: "#fff",
      toolMode: "view" as const, onMove: vi.fn(), onSelect: vi.fn(), onPlace: vi.fn() };
    act(() => root.render(<BuilderCanvas {...props} />));
    expect(element.querySelector("[data-testid='construction-controls']")).toBeNull();
    expect(element.querySelector("[aria-label='Verbindungen anzeigen']")).toBeNull();
    expect(element.querySelector("[aria-label='Verbindungsvorschau anzeigen']")).toBeNull();
    expect(element.querySelector("[aria-label='Kollisionswarnung anzeigen']")).toBeNull();
    expect(element.querySelector("[aria-label='Schwebewarnung anzeigen']")).toBeNull();
  });
  for (const webgl of [true, false]) {
    it(`drags a build preview onto plate studs without orbiting and commits the visible snap in ${webgl ? "WebGL" : "compatibility"} mode`, async () => {
      observed.webglEnabled = webgl;
      const snapshot = JSON.parse(new TextDecoder().decode(gunzipSync(
        readFileSync(resolve("public/parts/import-geometry-2026-10-31.bin")),
      )));
      const imported = connectionFixture(partLine("3795", 0, -8));
      const model = connectionFixture(partLine("3023b"));
      for (const item of [imported, model]) {
        item.resources = Object.fromEntries(snapshot.files.map((file: { path: string }) => [file.path, file]));
        item.instances.forEach(instance => { instance.part.status = "resolved"; });
      }
      const prepared: PreparedPart = {
        part: { id: "plate-1x2", packageId: "catalog", ldrawId: "3023b", name: "Plate 1 x 2",
          category: "Plates", keywords: [], file: "parts/3023b.dat" },
        model, bottom: localPartBounds(model, model.instances[0].reference)
          .clone().applyMatrix4(worldMatrix(model.instances[0].matrix)).min.y,
      };
      const onPlace = vi.fn();
      act(() => root.render(<BuilderCanvas bricks={[]} imported={imported} selectedId={null}
        selectedType="brick-1x2" selectedColor="#B40000" placementPreview={prepared}
        toolMode="build" onPlace={onPlace} onSelect={vi.fn()} onMove={vi.fn()} />));
      await act(async () => { await vi.waitFor(() => {
        if (webgl) expect(observed.scene3d?.getObjectByName("placement-preview")).toBeDefined();
        else expect(observed.scene).toBeDefined();
      }); });
      host = element.querySelector("[data-testid='canvas-3d']")!;
      flushFrame();
      observed.camera!.updateMatrixWorld(true);
      const cameraPosition = observed.camera!.position.clone();
      const cameraQuaternion = observed.camera!.quaternion.clone();
      const project = (x: number, y: number, z: number) => {
        const point = new Vector3(x, y, z).project(observed.camera!);
        return { x: (point.x + 1) * 300, y: (1 - point.y) * 300 };
      };
      const start = project(4, 0, 3), end = project(0.03, 0.4, 0.52);
      const search = vi.spyOn(snapping, "magneticConstructionTransform");
      const fallbackRender = vi.spyOn(FallbackRenderer.prototype, "render");
      pointer("pointerdown", start.x, start.y);
      pointer("pointermove", end.x, end.y);
      flushFrame();
      expect(onPlace).not.toHaveBeenCalled();
      expect(observed.camera!.position.equals(cameraPosition)).toBe(true);
      expect(observed.camera!.quaternion.equals(cameraQuaternion)).toBe(true);
      const snapped = search.mock.results.at(-1)!.value.transform;
      expect(snapped.contacts).toHaveLength(2);
      expect(snapped.matrix).toEqual([1, 0, 0, 0, 0, 1, 0, -16, 0, 0, 1, 10]);
      if (webgl) {
        const previewRoot = observed.scene3d!.getObjectByName("placement-preview") as Group;
        const mesh = previewRoot.children.find(child => child instanceof InstancedMesh) as InstancedMesh;
        const matrix = new Matrix4();
        mesh.getMatrixAt(0, matrix);
        expect(matrix.elements[12]).toBeCloseTo(0);
        expect(matrix.elements[13]).toBeCloseTo(0.8);
        expect(matrix.elements[14]).toBeCloseTo(0.5);
      } else {
        expect((fallbackRender.mock.lastCall![10] as { matrix: Affine }).matrix).toEqual(snapped.matrix);
      }
      pointer("pointerup", end.x, end.y);
      expect(onPlace).toHaveBeenCalledOnce();
      expect(onPlace.mock.calls[0][1]).toEqual(snapped.matrix);
      let document = placePreparedPart({ ...createEmptyDocument(), imported }, prepared, onPlace.mock.calls[0][0], "#B40000");
      const id = document.imported!.instances.at(-1)!.id;
      document = moveImported(document, id, onPlace.mock.calls[0][0], false, onPlace.mock.calls[0][1]);
      expect(snapping.activeConnections(document.imported!, id)).toHaveLength(2);
      onPlace.mockClear();
      pointer("pointerdown", start.x, start.y, 1);
      pointer("pointerdown", start.x + 40, start.y, 2);
      pointer("pointermove", start.x + 80, start.y + 30, 2);
      pointer("pointerup", start.x + 80, start.y + 30, 2);
      pointer("pointermove", end.x, end.y, 1);
      pointer("pointerup", end.x, end.y, 1);
      expect(observed.camera!.position.equals(cameraPosition)).toBe(false);
      expect(onPlace).not.toHaveBeenCalled();
      fallbackRender.mockRestore();
    });
    it(`shows a real LDraw placement preview without committing in ${webgl ? "WebGL" : "compatibility"} mode`, async () => {
      observed.webglEnabled = webgl;
      const snapshot = JSON.parse(new TextDecoder().decode(gunzipSync(
        readFileSync(resolve("public/parts/import-geometry-2026-10-31.bin")),
      )));
      const model = connectionFixture(partLine("3023b"));
      model.resources = Object.fromEntries(snapshot.files.map((file: { path: string }) => [file.path, file]));
      const source = model.instances[0];
      source.part.status = "resolved";
      const bottom = localPartBounds(model, source.reference)
        .clone().applyMatrix4(worldMatrix(source.matrix)).min.y;
      const prepared: PreparedPart = {
        part: { id: "plate-1x2", packageId: "catalog", ldrawId: "3023b", name: "Plate 1 x 2",
          category: "Plates", keywords: [], file: "parts/3023b.dat" },
        model, bottom,
      };
      const committedSnapshot = JSON.stringify(model.instances);
      const onPlace = vi.fn(), props = {
        projectId: `placement-preview-${webgl}`, bricks: [], imported: model, selectedId: null,
        selectedType: "brick-2x4" as const, selectedColor: "#B40000", selectedColorCode: "4",
        placementPreview: prepared, toolMode: "build" as const,
        onMove: vi.fn(), onSelect: vi.fn(), onPlace,
      };
      const fallbackRender = vi.spyOn(FallbackRenderer.prototype, "render");
      act(() => root.render(<BuilderCanvas {...props} />));
      await act(async () => { await vi.waitFor(() => {
        if (webgl) expect(observed.scene3d?.getObjectByName("placement-preview")).toBeDefined();
        else expect(element.querySelector("[data-renderer='canvas-fallback']")).toBeDefined();
      }); });
      host = element.querySelector("[data-testid='canvas-3d']")!;
      flushFrame();
      expect(onPlace).not.toHaveBeenCalled();
      expect(model.instances).toHaveLength(1);
      if (webgl) {
        const previewRoot = observed.scene3d!.getObjectByName("placement-preview") as Group;
        const index = instanceIndex(previewRoot)!;
        expect(index.model.instances[0].colorCode).toBe("4");
        expect(index.records.has("placement-preview")).toBe(true);
      } else {
        const preview = fallbackRender.mock.lastCall![10] as { surfaces: unknown[]; colorCode: string };
        expect(preview.surfaces.length).toBeGreaterThan(0);
        expect(preview.colorCode).toBe("4");
      }

      observed.camera!.updateMatrixWorld(true);
      const projected = new Vector3(1, 0, 1).project(observed.camera!);
      const target = { x: (projected.x + 1) * 300, y: (1 - projected.y) * 300 };
      pointer("pointermove", target.x, target.y);
      flushFrame();
      const visiblePosition = () => {
        if (webgl) {
          const previewRoot = observed.scene3d!.getObjectByName("placement-preview") as Group;
          const mesh = previewRoot.children.find(child => child instanceof InstancedMesh) as InstancedMesh;
          const matrix = new Matrix4();
          mesh.getMatrixAt(0, matrix);
          return [matrix.elements[12], matrix.elements[13], matrix.elements[14]];
        }
        const preview = fallbackRender.mock.lastCall![10] as { matrix: Affine };
        return [preview.matrix[3], preview.matrix[7], preview.matrix[11]];
      };
      if (webgl) {
        expect(visiblePosition()[0]).toBeCloseTo(1);
        expect(visiblePosition()[2]).toBeCloseTo(1);
      } else {
        expect(visiblePosition()[0]).toBeCloseTo(20);
        expect(visiblePosition()[2]).toBeCloseTo(20);
      }
      const positionBeforeColorChange = visiblePosition();

      const assertPreviewAppearance = (code: string, alpha: number, hex: string) => {
        expect(model.instances).toHaveLength(1);
        expect(JSON.stringify(model.instances)).toBe(committedSnapshot);
        expect(onPlace).not.toHaveBeenCalled();
        if (webgl) {
          const previewRoot = observed.scene3d!.getObjectByName("placement-preview") as Group;
          const index = instanceIndex(previewRoot)!;
          expect(index.model.instances[0].colorCode).toBe(code);
          const inheritedFace = index.records.get("placement-preview")!.slots
            .map(slot => slot.draw)
            .find(draw => draw instanceof InstancedMesh && draw.userData.inherited) as InstancedMesh | undefined;
          expect(inheritedFace).toBeDefined();
          const material = inheritedFace!.material as MeshLambertMaterial;
          expect(material.opacity).toBeCloseTo(alpha / 255);
          expect(material.transparent).toBe(alpha < 255);
          expect(material.depthWrite).toBe(alpha === 255);
          const color = new Color();
          inheritedFace!.getColorAt(0, color);
          expect(color.getHexString()).toBe(hex);
          const committedRoot = observed.scene3d!.children.find(child =>
            child instanceof Group && child.name !== "placement-preview" && instanceIndex(child),
          ) as Group | undefined;
          expect(committedRoot).toBeDefined();
          expect(JSON.stringify(instanceIndex(committedRoot!)!.model.instances)).toBe(committedSnapshot);
        } else {
          const preview = fallbackRender.mock.lastCall![10] as { surfaces: unknown[]; colorCode: string };
          expect(preview.surfaces.length).toBeGreaterThan(0);
          expect(preview.colorCode).toBe(code);
          expect(JSON.stringify(observed.scene!.model.instances)).toBe(committedSnapshot);
        }
      };

      act(() => root.render(<BuilderCanvas {...props} selectedColor="#AEE9EF" selectedColorCode="43" />));
      flushFrame();
      expect(visiblePosition()).toEqual(positionBeforeColorChange);
      assertPreviewAppearance("43", 128, "aee9ef");

      act(() => root.render(<BuilderCanvas {...props} selectedColor="#F4F4F4" selectedColorCode="15" />));
      flushFrame();
      expect(visiblePosition()).toEqual(positionBeforeColorChange);
      assertPreviewAppearance("15", 255, "f4f4f4");

      pointer("pointerdown", target.x, target.y);
      pointer("pointercancel", target.x, target.y);
      expect(onPlace).not.toHaveBeenCalled();
      pointer("pointerdown", target.x, target.y);
      pointer("pointerup", target.x, target.y);
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 620)); });
      expect(onPlace).toHaveBeenCalledOnce();
      expect(model.instances).toHaveLength(1);

      await act(async () => root.render(<BuilderCanvas {...props} toolMode="select" />));
      flushFrame();
      if (webgl) {
        expect(observed.scene3d?.getObjectByName("placement-preview")).toBeUndefined();
      } else {
        expect(fallbackRender.mock.lastCall![10]).toBeNull();
        expect(fallbackRender.mock.lastCall![11]).toBeNull();
      }
      expect(onPlace).toHaveBeenCalledOnce();
      expect(model.instances).toHaveLength(1);

      await act(async () => root.render(<BuilderCanvas {...props} projectId="next-project" />));
      flushFrame();
      if (webgl) {
        expect(observed.scene3d?.getObjectByName("placement-preview")).toBeUndefined();
      } else {
        expect(fallbackRender.mock.lastCall![10]).toBeNull();
        expect(fallbackRender.mock.lastCall![11]).toBeNull();
      }
      expect(onPlace).toHaveBeenCalledOnce();
      expect(model.instances).toHaveLength(1);
    });
    it(`updates built-in brick preview color in ${webgl ? "WebGL" : "compatibility"} mode`, async () => {
      observed.webglEnabled = webgl;
      const fallbackRender = vi.spyOn(FallbackRenderer.prototype, "render");
      const onPlace = vi.fn();
      const props = {
        bricks: [], selectedId: null, selectedType: "brick-1x2" as const, selectedColor: "#e4b844",
        toolMode: "build" as const, onMove: vi.fn(), onSelect: vi.fn(), onPlace,
      };
      act(() => root.render(<BuilderCanvas {...props} />));
      host = element.querySelector("[data-testid='canvas-3d']")!;
      flushFrame();
      const preview = observed.scene3d?.getObjectByName("placement-preview");
      if (webgl) {
        expect(preview).toBeInstanceOf(Mesh);
        expect((preview as Mesh).geometry.getAttribute("position").count).toBeGreaterThan(0);
        expect(((preview as Mesh).material as MeshLambertMaterial).color.getHexString()).toBe("e4b844");
      } else {
        const brick = fallbackRender.mock.lastCall![11] as Brick;
        expect(brick).toMatchObject({ id: "placement-preview-brick", type: "brick-1x2", color: "#e4b844" });
      }

      observed.camera!.updateMatrixWorld(true);
      const projected = new Vector3(1, 0, 1).project(observed.camera!);
      const target = { x: (projected.x + 1) * 300, y: (1 - projected.y) * 300 };
      pointer("pointermove", target.x, target.y);
      flushFrame();
      const visiblePosition = () => {
        if (webgl) {
          const preview = observed.scene3d?.getObjectByName("placement-preview") as Mesh;
          return [preview.position.x, preview.position.y, preview.position.z];
        }
        const brick = fallbackRender.mock.lastCall![11] as Brick;
        return [brick.x, brick.y, brick.z];
      };
      if (webgl) {
        expect(visiblePosition()[0]).toBeCloseTo(1);
        expect(visiblePosition()[2]).toBeCloseTo(1);
      } else {
        expect(visiblePosition()[0]).toBeCloseTo(1);
        expect(visiblePosition()[2]).toBeCloseTo(1);
      }
      const positionBeforeColorChange = visiblePosition();
      act(() => root.render(<BuilderCanvas {...props} selectedColor="#1E5AA8" />));
      flushFrame();
      expect(visiblePosition()).toEqual(positionBeforeColorChange);
      expect(onPlace).not.toHaveBeenCalled();
      if (webgl) {
        const updatedPreview = observed.scene3d?.getObjectByName("placement-preview") as Mesh;
        expect(updatedPreview).toBeInstanceOf(Mesh);
        expect((updatedPreview.material as MeshLambertMaterial).color.getHexString()).toBe("1e5aa8");
      } else {
        expect(fallbackRender.mock.lastCall![11]).toMatchObject({ color: "#1E5AA8" });
      }
      pointer("pointerdown", target.x, target.y);
      pointer("pointercancel", target.x, target.y);
      expect(onPlace).not.toHaveBeenCalled();
      pointer("pointerdown", target.x, target.y);
      expect(onPlace).not.toHaveBeenCalled();
      pointer("pointerup", target.x, target.y);
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 620)); });
      expect(onPlace).toHaveBeenCalledOnce();
    });
  }
  it("paints selected translucent LDraw colors with their alpha and appearance in compatibility mode", () => {
    const renderer = new FallbackRenderer();
    renderer.setSize(600, 600);
    const camera = new PerspectiveCamera(42, 1, 0.1, 4000);
    camera.position.set(0, 0, 10);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld(true);
    const geometry = {
      surfaces: [{
        colorCode: "16",
        positions: new Float32Array([-1, -1, 0, 1, -1, 0, 0, 1, 0]),
        normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
        edges: new Float32Array(),
      }],
      matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0] as Affine,
      colorCode: "43",
    } satisfies NonNullable<Parameters<FallbackRenderer["render"]>[10]>;

    renderer.render(camera, new Vector3(), [], null, undefined, 0, false, undefined,
      constructionArea(new Box3(new Vector3(-2, -2, -2), new Vector3(2, 2, 2))), false, geometry);

    const paint = observedPaints.find(item => Math.abs(item.globalAlpha - 128 / 255) < 1e-6);
    expect(paint).toBeDefined();
    expect(paint!.fillStyle).toMatch(/^rgb\(/);
    const channels = paint!.fillStyle.match(/\d+/g)!.map(Number);
    expect(channels[0]).toBeGreaterThanOrEqual(97);
    expect(channels[0]).toBeLessThanOrEqual(174);
    expect(channels[1]).toBeGreaterThanOrEqual(135);
    expect(channels[1]).toBeLessThanOrEqual(233);
    expect(channels[2]).toBeGreaterThanOrEqual(138);
    expect(channels[2]).toBeLessThanOrEqual(239);

    observedPaints.length = 0;
    renderer.render(camera, new Vector3(), [], null, undefined, 0, false, undefined,
      constructionArea(new Box3(new Vector3(-2, -2, -2), new Vector3(2, 2, 2))), false,
      { ...geometry, colorCode: "15" });
    const opaquePaint = observedPaints.find(item =>
      Math.abs(item.globalAlpha - 1) < 1e-6 && item.fillStyle !== "#e1e6df");
    expect(opaquePaint).toBeDefined();
    expect(opaquePaint!.fillStyle).toMatch(/^rgb\(/);
    const opaqueChannels = opaquePaint!.fillStyle.match(/\d+/g)!.map(Number);
    for (const channel of opaqueChannels) {
      expect(channel).toBeGreaterThanOrEqual(198);
      expect(channel).toBeLessThanOrEqual(244);
    }
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
    const search = vi.spyOn(snapping, "magneticConstructionTransform");
    pointer("pointerdown", start.x, start.y);
    pointer("pointermove", end.x, end.y);
    flushFrame();
    expect(search).toHaveBeenCalledOnce();
    expect(search.mock.calls[0]).toEqual([model, id, expect.any(Object), undefined, true]);
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
    it(`restores and re-expands the committed floor after undo and redo in ${rendererName}`, async () => {
      observed.webglEnabled = webgl;
      const model = engineFixture(2, 3);
      const id = model.instances[1].id;
      const initialDocument = { ...createEmptyDocument(), imported: model };
      const movedDocument = moveImported(initialDocument, id, { x: 180, y: 0, z: -120 });
      let history = createHistory(initialDocument);
      const props = { projectId: `floor-history-${rendererName}`, bricks: [], selectedId: null,
        selectedType: "brick-2x4" as const, selectedColor: "#B40000", toolMode: "select" as const,
        onMove: vi.fn(), onSelect: vi.fn(), onPlace: vi.fn() };
      const renderHistory = async () => {
        await act(async () => root.render(<BuilderCanvas {...props} imported={history.document.imported} />));
        await act(async () => {
          await vi.waitFor(() => expect(webgl ? instanceIndex(
            observed.scene3d!.children.find(child => instanceIndex(child as Group)) as Group,
          ) : observed.scene).toBeDefined());
        });
        flushFrame();
      };

      await renderHistory();
      const initialBounds = currentImportedBounds(webgl);
      const camera = { ...observed.cameraPose! };
      const expectedBounds = (source: ImportedModel) => source.instances.reduce(
        (bounds, instance) => bounds.union(transformedPartBounds(source, instance)),
        new Box3(),
      );
      const expectedInitialBounds = expectedBounds(initialDocument.imported!);
      expectConstructionArea(expectedInitialBounds);

      const expectedMovedBounds = expectedBounds(movedDocument.imported!);
      const initialArea = constructionArea(expectedInitialBounds);
      const movedArea = constructionArea(expectedMovedBounds);
      expect(movedArea.width).toBeGreaterThan(initialArea.width);
      expect(movedArea.depth).toBeGreaterThan(initialArea.depth);
      history = commit(history, movedDocument);
      await renderHistory();
      expectConstructionArea(expectedMovedBounds);
      expect(currentImportedBounds(webgl).max.x).toBeGreaterThan(initialBounds.max.x + 100);
      expect(currentImportedBounds(webgl).min.z).toBeLessThan(initialBounds.min.z - 100);
      expectCameraPose(camera);

      history = undo(history);
      await renderHistory();
      expectConstructionArea(expectedInitialBounds);
      expect(currentImportedBounds(webgl).max.x).toBeCloseTo(initialBounds.max.x, 2);
      expect(currentImportedBounds(webgl).min.z).toBeCloseTo(initialBounds.min.z, 2);
      expectCameraPose(camera);

      history = redo(history);
      await renderHistory();
      expectConstructionArea(expectedMovedBounds);
      expect(currentImportedBounds(webgl).max.x).toBeGreaterThan(initialBounds.max.x + 100);
      expect(currentImportedBounds(webgl).min.z).toBeLessThan(initialBounds.min.z - 100);
      expectCameraPose(camera);
    });

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
      const end = screenPoint(-50, original.y, 0);
      const pointOnGround = (point: { x: number; y: number }) => {
        const raycaster = new Raycaster();
        raycaster.setFromCamera(new Vector2((point.x - 300) / 300, (300 - point.y) / 300), observed.camera!);
        return raycaster.ray.intersectPlane(new Plane(new Vector3(0, 1, 0), -original.y), new Vector3())!;
      };
      const startOnGround = pointOnGround(start), endOnGround = pointOnGround(end);
      const previewBrick = {
        ...original,
        x: Math.round(original.x + endOnGround.x - startOnGround.x),
        z: Math.round(original.z + endOnGround.z - startOnGround.z),
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
  it("drags a selected secondary member and reports one shared group offset", () => {
    const bricks: Brick[] = [
      { id: "group-primary", type: "brick-2x2", color: "#B40000", x: 0, y: 0, z: 0, rotation: 35 },
      { id: "group-secondary", type: "brick-1x2", color: "#B40000", x: 8, y: 0, z: 0, rotation: 90 },
    ];
    const onMove = vi.fn(), onMoveGroup = vi.fn(), onSelect = vi.fn();
    const props = { bricks, selectedId: bricks[0].id, selectedIds: bricks.map(brick => brick.id),
      selectedType: "brick-2x2" as const, selectedColor: "#B40000", toolMode: "select" as const,
      onMove, onMoveGroup, onSelect, onPlace: vi.fn() };
    act(() => root.render(<BuilderCanvas {...props} />));
    host = element.querySelector("[data-testid='canvas-3d']")!;
    flushFrame();
    const outlinedIds: string[] = [];
    observed.scene3d!.traverse(object => {
      if (object.userData.isSelectionOutline) outlinedIds.push(object.userData.selectionId);
    });
    expect(outlinedIds.sort()).toEqual(bricks.map(brick => brick.id).sort());
    observed.camera!.updateMatrixWorld(true);
    const project = (point: Vector3) => {
      const projected = point.project(observed.camera!);
      return { x: (projected.x + 1) * 300, y: (1 - projected.y) * 300 };
    };
    const start = project(new Vector3(8, 1.11, 0));
    const ray = new Raycaster();
    ray.setFromCamera(new Vector2((start.x - 300) / 300, (300 - start.y) / 300), observed.camera!);
    const planeStart = ray.ray.intersectPlane(new Plane(new Vector3(0, 1, 0), 0), new Vector3())!;
    const end = project(planeStart.clone().add(new Vector3(1.2, 0, 2.2)));
    pointer("pointerdown", start.x, start.y);
    pointer("pointermove", end.x, end.y);
    flushFrame();
    pointer("pointerup", end.x, end.y);

    expect(onSelect).not.toHaveBeenCalled();
    expect(onMove).not.toHaveBeenCalled();
    expect(onMoveGroup).toHaveBeenCalledOnce();
    expect(onMoveGroup.mock.calls[0][0]).toEqual(bricks.map(brick => brick.id));
    expect(onMoveGroup.mock.calls[0][1].x).toBeGreaterThan(0);
    expect(onMoveGroup.mock.calls[0][1].z).toBeGreaterThan(0);
  });
  async function mount(toolMode: ToolMode = "select") {
    const model = engineFixture(1, 2), onMove = vi.fn(), onSelect = vi.fn(), onToggleSelection = vi.fn(), onViewPartTap = vi.fn();
    const onOpenRotationControls = vi.fn(), onPlace = vi.fn();
    const props = { projectId: "one", bricks: [], imported: model, selectedId: model.instances[0].id,
      selectedType: "brick-2x4" as const, selectedColor: "#B40000", toolMode, onMove, onSelect,
      onViewPartTap, onOpenRotationControls, onToggleSelection, onPlace };
    act(() => { root.render(<BuilderCanvas {...props} />); });
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 30)); });
    host = element.querySelector("[data-testid='canvas-3d']")!;
    flushFrame();
    expect(observed.scene).toBeDefined();
    return { model, onMove, props, point: pickPoint() };
  }
  it("outlines every selected imported part in the WebGL scene", async () => {
    observed.webglEnabled = true;
    const model = engineFixture(2, 3), selectedIds = model.instances.slice(0, 2).map(instance => instance.id);
    const props = { projectId: "multi-selected-import", bricks: [], imported: model,
      selectedId: selectedIds[0], selectedIds, selectedType: "brick-2x4" as const,
      selectedColor: "#B40000", toolMode: "select" as const,
      onMove: vi.fn(), onSelect: vi.fn(), onPlace: vi.fn() };
    act(() => root.render(<BuilderCanvas {...props} />));
    host = element.querySelector("[data-testid='canvas-3d']")!;
    await act(async () => {
      await vi.waitFor(() => expect(observed.scene3d?.children.some(child => instanceIndex(child as Group))).toBe(true));
    });
    flushFrame();
    const outlinedIds: string[] = [];
    observed.scene3d!.traverse(object => {
      if (typeof object.userData.selectionId === "string") outlinedIds.push(object.userData.selectionId);
    });
    expect(outlinedIds.sort()).toEqual(selectedIds.sort());
  });
  it("selects a part after a short, stationary tap in view mode", async () => {
    const { props, point, model } = await mount("view");
    pointer("pointerdown", point.x, point.y);
    pointer("pointerup", point.x, point.y);

    expect(props.onViewPartTap).toHaveBeenCalledWith(model.instances[0].id);
    expect(props.onSelect).not.toHaveBeenCalled();
    expect(props.onMove).not.toHaveBeenCalled();
  });
  it("zooms in by two on a double tap on empty space in view mode", async () => {
    await mount("view");
    flushFrame();
    const target = new Vector3(...observed.cameraPose!.target);
    const initialDistance = observed.camera!.position.distanceTo(target);
    const empty = { x: 8, y: 8 };
    pointer("pointerdown", empty.x, empty.y);
    pointer("pointerup", empty.x, empty.y);
    pointer("pointerdown", empty.x, empty.y);
    pointer("pointerup", empty.x, empty.y);
    flushFrame();

    const zoomedDistance = observed.camera!.position.distanceTo(new Vector3(...observed.cameraPose!.target));
    expect(zoomedDistance).toBeCloseTo(initialDistance / 2, 2);
  });
  it("zooms in by two on a double tap on empty space in selection mode", async () => {
    await mount("select");
    flushFrame();
    const target = new Vector3(...observed.cameraPose!.target);
    const initialDistance = observed.camera!.position.distanceTo(target);
    const empty = { x: 8, y: 8 };
    pointer("pointerdown", empty.x, empty.y);
    pointer("pointerup", empty.x, empty.y);
    pointer("pointerdown", empty.x, empty.y);
    pointer("pointerup", empty.x, empty.y);
    flushFrame();

    const zoomedDistance = observed.camera!.position.distanceTo(new Vector3(...observed.cameraPose!.target));
    expect(zoomedDistance).toBeCloseTo(initialDistance / 2, 2);
  });
  it("does not double-tap zoom on empty space while a menu is open", async () => {
    const { props } = await mount("select");
    act(() => root.render(<BuilderCanvas {...props} emptyDoubleTapZoomEnabled={false} />));
    flushFrame();
    const target = new Vector3(...observed.cameraPose!.target);
    const initialDistance = observed.camera!.position.distanceTo(target);
    const empty = { x: 8, y: 8 };
    pointer("pointerdown", empty.x, empty.y);
    pointer("pointerup", empty.x, empty.y);
    pointer("pointerdown", empty.x, empty.y);
    pointer("pointerup", empty.x, empty.y);
    flushFrame();

    const distance = observed.camera!.position.distanceTo(new Vector3(...observed.cameraPose!.target));
    expect(distance).toBeCloseTo(initialDistance, 2);
  });
  it("keeps Build mode by default after double-tap placement", async () => {
    const { props } = await mount("build");
    const toggle = element.querySelector<HTMLButtonElement>("[data-testid='button-auto-select-after-placement']")!;
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    const empty = { x: 8, y: 8 };
    pointer("pointerdown", empty.x, empty.y);
    pointer("pointerup", empty.x, empty.y);
    expect(props.onPlace).not.toHaveBeenCalled();

    pointer("pointerdown", empty.x, empty.y);
    pointer("pointerup", empty.x, empty.y);

    expect(props.onPlace).toHaveBeenCalledOnce();
    expect(props.onPlace.mock.calls[0][2]).toEqual({ stayInBuildMode: true, floorSnap: true });
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 620)); });
    expect(props.onPlace).toHaveBeenCalledOnce();
  });
  it("can switch to Select after double-tap placement when the toggle is enabled", async () => {
    const { props } = await mount("build");
    const toggle = element.querySelector<HTMLButtonElement>("[data-testid='button-auto-select-after-placement']")!;
    act(() => toggle.click());
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    const empty = { x: 8, y: 8 };
    pointer("pointerdown", empty.x, empty.y);
    pointer("pointerup", empty.x, empty.y);
    pointer("pointerdown", empty.x, empty.y);
    pointer("pointerup", empty.x, empty.y);
    expect(props.onPlace).toHaveBeenCalledOnce();
    expect(props.onPlace.mock.calls[0][2]).toEqual({ floorSnap: true });
  });
  it("keeps a single empty-space tap in build mode as the normal placement action", async () => {
    const { props } = await mount("build");
    const empty = { x: 8, y: 8 };
    pointer("pointerdown", empty.x, empty.y);
    pointer("pointerup", empty.x, empty.y);
    expect(props.onPlace).not.toHaveBeenCalled();

    await act(async () => { await new Promise(resolve => setTimeout(resolve, 620)); });

    expect(props.onPlace).toHaveBeenCalledOnce();
    expect(props.onPlace.mock.calls[0][2]).toEqual({ stayInBuildMode: true, floorSnap: true });
  });
  it("treats a build-mode part double tap as one normal placement", async () => {
    const { props, point } = await mount("build");
    pointer("pointerdown", point.x, point.y);
    pointer("pointerup", point.x, point.y);
    pointer("pointerdown", point.x, point.y);
    pointer("pointerup", point.x, point.y);
    expect(props.onOpenRotationControls).not.toHaveBeenCalled();
    expect(props.onMove).not.toHaveBeenCalled();
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 620)); });
    expect(props.onPlace).toHaveBeenCalledOnce();
    expect(props.onPlace.mock.calls[0][2]).toEqual({ stayInBuildMode: true });
  });
  it("opens rotation controls on a double tap only in selection mode", async () => {
    const { props, point, model } = await mount("select");
    pointer("pointerdown", point.x, point.y);
    pointer("pointerup", point.x, point.y);
    pointer("pointerdown", point.x, point.y);
    pointer("pointerup", point.x, point.y);
    expect(props.onOpenRotationControls).toHaveBeenCalledWith(model.instances[0].id);
    expect(props.onPlace).not.toHaveBeenCalled();
  });
  it("does not open rotation controls on a view-mode double tap after tap-selection switches modes", async () => {
    const { props, point, model } = await mount("view");
    pointer("pointerdown", point.x, point.y);
    pointer("pointerup", point.x, point.y);
    expect(props.onViewPartTap).toHaveBeenCalledWith(model.instances[0].id);
    act(() => root.render(<BuilderCanvas {...props} toolMode="select" selectedId={model.instances[0].id} />));
    pointer("pointerdown", point.x, point.y);
    pointer("pointerup", point.x, point.y);
    expect(props.onOpenRotationControls).not.toHaveBeenCalled();
    expect(props.onSelect).toHaveBeenCalledWith(model.instances[0].id);
  });
  it("does nothing on a view-mode part double tap when tap-selection is disabled", async () => {
    const { props, point } = await mount("view");
    const toggle = element.querySelector<HTMLButtonElement>("[data-testid='button-view-tap-select-toggle']")!;
    act(() => toggle.click());
    const target = new Vector3(...observed.cameraPose!.target);
    const initialDistance = observed.camera!.position.distanceTo(target);
    pointer("pointerdown", point.x, point.y);
    pointer("pointerup", point.x, point.y);
    pointer("pointerdown", point.x, point.y);
    pointer("pointerup", point.x, point.y);
    expect(props.onViewPartTap).not.toHaveBeenCalled();
    expect(props.onSelect).not.toHaveBeenCalled();
    expect(props.onOpenRotationControls).not.toHaveBeenCalled();
    expect(observed.camera!.position.distanceTo(target)).toBeCloseTo(initialDistance);
  });
  it("does not open rotation controls on a delete-mode double tap", async () => {
    const { props, point, model } = await mount("delete");
    pointer("pointerdown", point.x, point.y);
    pointer("pointerup", point.x, point.y);
    pointer("pointerdown", point.x, point.y);
    pointer("pointerup", point.x, point.y);
    expect(props.onOpenRotationControls).not.toHaveBeenCalled();
    expect(props.onSelect).toHaveBeenCalledOnce();
    expect(props.onSelect).toHaveBeenNthCalledWith(1, model.instances[0].id);
  });
  it("keeps long presses in view mode while allowing camera orbit", async () => {
    const { props, point } = await mount("view");
    const cameraBefore = observed.camera!.position.clone();
    pointer("pointerdown", point.x, point.y);
    await new Promise(resolve => setTimeout(resolve, 420));
    pointer("pointermove", point.x + 30, point.y + 15);
    pointer("pointerup", point.x + 30, point.y + 15);

    expect(props.onViewPartTap).not.toHaveBeenCalled();
    expect(props.onSelect).not.toHaveBeenCalled();
    expect(observed.camera!.position.equals(cameraBefore)).toBe(false);
  });
  it("allows disabling view-mode tap selection with its icon toggle", async () => {
    const { props, point } = await mount("view");
    const toggle = element.querySelector<HTMLButtonElement>("[data-testid='button-view-tap-select-toggle']")!;
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    expect(toggle.classList.contains("canvas-control-toggle")).toBe(true);
    expect(toggle.classList.contains("view-tap-select-toggle")).toBe(true);
    expect(toggle.querySelector("svg")).not.toBeNull();
    act(() => toggle.click());
    expect(toggle.getAttribute("aria-pressed")).toBe("false");

    pointer("pointerdown", point.x, point.y);
    pointer("pointerup", point.x, point.y);
    expect(props.onViewPartTap).not.toHaveBeenCalled();

    act(() => root.render(<BuilderCanvas {...props} toolMode="select" />));
    expect(element.querySelector("[data-testid='button-view-tap-select-toggle']")).toBeNull();
  });
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
