import { afterEach, expect, it, vi } from "vitest";
import { BufferGeometry, Color, InstancedMesh, Mesh, Vector3, type Camera, type Scene } from "three";
import { createEmptyDocument, type BuilderDocument } from "../editor/model";
import { createLocalBrickGeometry } from "../engine/local-brick-geometry";
import { brickTransformMatrix } from "../editor/brick-transform";
import { createSoftwareInstructionRenderer } from "./software-render";
import { parseLDraw } from "../formats/ldraw/parser";
import { createInstructionRenderer } from "./render";
import { exportInstructionPDF } from "./pdf";
import { instructionDisplayColor } from "./highlight-color";

vi.mock("../engine/local-brick-geometry", async importOriginal => {
  const module = await importOriginal<typeof import("../engine/local-brick-geometry")>();
  return { ...module, createLocalBrickGeometry: vi.fn(module.createLocalBrickGeometry) };
});

const { frames, rendererDispose, forceContextLoss, rendererSetSize } = vi.hoisted(() => ({
  frames: vi.fn(), rendererDispose: vi.fn(), forceContextLoss: vi.fn(), rendererSetSize: vi.fn(),
}));
vi.mock("three", async importOriginal => {
  const three = await importOriginal<typeof import("three")>();
  return { ...three, WebGLRenderer: class {
    domElement = { toDataURL: () => "data:image/jpeg;base64,webgl" };
    setPixelRatio() {} setSize(width: number, height: number) { rendererSetSize(width, height); } setClearColor() {}
    dispose() { rendererDispose(); }
    forceContextLoss() { forceContextLoss(); }
    render(scene: Scene, camera: Camera) {
      scene.updateMatrixWorld(true); camera.updateMatrixWorld(true); frames(scene, camera);
    }
  } };
});

it("matches tilted and stacked local geometry and projected triangles in both PDF paths", async () => {
  const document = createEmptyDocument();
  document.bricks = [
    { id: "base", type: "brick-2x4", color: "#ff0000", x: 0, y: 0, z: 0, rotation: 0 },
    { id: "stack", type: "brick-2x2", color: "#00ff00", x: 0, y: 1.2, z: 0, rotation: 90 },
    { id: "tilt", type: "brick-1x2", color: "#0000ff", x: 3, y: 2.4, z: 1, rotation: 35, tiltX: 28, tiltZ: -19 },
    { id: "repeat", type: "brick-2x4", color: "#ffff00", x: -4, y: 3, z: 2, rotation: 67, tiltX: -13, tiltZ: 22 },
  ];
  const before = JSON.stringify(document), softwareFaces: number[][] = [];
  let path: number[] = [];
  const context = {
    fillRect() {}, drawImage() {}, beginPath() { path = []; },
    moveTo(x: number, y: number) { path.push(x, y); },
    lineTo(x: number, y: number) { path.push(x, y); },
    closePath() {}, fill() { softwareFaces.push(path.slice()); },
  };
  vi.stubGlobal("document", { createElement: () => ({
    width: 0, height: 0, getContext: () => context, toDataURL: () => "data:image/jpeg;base64,software",
  }) });
  const webgl = await createInstructionRenderer(document);
  const software = await createSoftwareInstructionRenderer(document);
  try {
    expect(rendererSetSize).toHaveBeenLastCalledWith(2000, 1520);
    for (const rotation of [[0, 0, 0], [20, 65, -15]] as [number, number, number][]) {
      const ids = new Set(document.bricks.map(brick => brick.id));
      const step = { id: "s", title: "", notes: "", partIds: [...ids], rotation };
      webgl.image(ids, step);
      const [scene, camera] = frames.mock.lastCall! as [Scene, Camera];
      const webglFaces: number[][] = [];
      scene.traverse(object => {
        if (!(object instanceof Mesh)) return;
        const part = document.bricks.find(brick => brick.id === object.parent?.userData.partId);
        if (!part) return;
        const expected = createLocalBrickGeometry(part.type);
        expect(object.geometry.getAttribute("position").array).toEqual(expected.getAttribute("position").array);
        expected.dispose();
        object.parent!.matrix.elements.forEach((value, index) =>
          expect(value).toBeCloseTo(brickTransformMatrix(part).elements[index], 12));
        const flat = object.geometry.toNonIndexed(), positions = flat.getAttribute("position");
        for (let index = 0; index < positions.count; index += 3) {
          webglFaces.push([0, 1, 2].flatMap(offset => {
            const point = new Vector3().fromBufferAttribute(positions, index + offset).applyMatrix4(object.matrixWorld).project(camera);
            return [(point.x + 1) * 1000, (1 - point.y) * 760];
          }));
        }
        flat.dispose();
      });
      softwareFaces.length = 0;
      software.image(ids, step);
      // Software stores world coordinates as float32; allow only that rounding.
      const sorted = (faces: number[][]) => faces.slice().sort((a, b) => {
        for (let index = 0; index < a.length; index++) {
          const difference = Math.round(a[index] * 1000) - Math.round(b[index] * 1000);
          if (difference) return difference;
        }
        return 0;
      });
      const actual = sorted(softwareFaces), expected = sorted(webglFaces);
      expect(actual.length).toBeGreaterThan(500);
      expect(actual).toHaveLength(expected.length);
      actual.forEach((face, index) => face.forEach((coordinate, component) =>
        expect(coordinate).toBeCloseTo(expected[index][component], 3)));
    }
    expect(JSON.stringify(document)).toBe(before);
  } finally { webgl.dispose(); software.dispose(); }
});
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

function repeatedDocument(count = 128): BuilderDocument {
  const document = createEmptyDocument();
  document.bricks = Array.from({ length: count }, (_, index) => ({
    id: `repeat-${index}`, type: "brick-2x2" as const,
    color: index % 2 ? "#ff0000" : "#0000ff",
    x: index % 16 * 3, y: 0, z: Math.floor(index / 16) * 3, rotation: index % 4 * 90,
  }));
  return document;
}

function stubCanvas() {
  const context = {
    fillStyle: "", globalAlpha: 1, fillRect: vi.fn(), drawImage: vi.fn(),
    beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), closePath: vi.fn(), fill: vi.fn(),
    save: vi.fn(), restore: vi.fn(), stroke: vi.fn(),
  };
  const canvas = { width: 0, height: 0, getContext: () => context,
    toDataURL: () => "data:image/jpeg;base64,test" };
  vi.stubGlobal("document", { createElement: () => canvas });
  return { canvas, context };
}

it("shares WebGL geometry but not occurrence colors, visibility or highlights, and disposes once", async () => {
  stubCanvas();
  const document = repeatedDocument(3);
  document.bricks[2].type = "brick-1x2";
  const renderer = await createInstructionRenderer(document);
  expect(createLocalBrickGeometry).toHaveBeenCalledTimes(2);
  const visible = new Set(document.bricks.slice(0, 2).map(part => part.id));
  const step = { id: "s", title: "", notes: "", partIds: [...visible] };
  renderer.image(visible, step, new Set([document.bricks[0].id]));
  const meshes: Mesh<BufferGeometry, import("three").MeshLambertMaterial>[] = [];
  (frames.mock.lastCall![0] as Scene).traverse(object => {
    if (object instanceof Mesh) meshes.push(object as typeof meshes[number]);
  });
  expect(meshes[0].geometry).toBe(meshes[1].geometry);
  expect(meshes[0].geometry).not.toBe(meshes[2].geometry);
  expect(meshes[0].material).not.toBe(meshes[1].material);
  meshes.forEach((mesh, index) => {
    const expected = new Color(document.bricks[index].color);
    instructionDisplayColor(expected, index === 0);
    expect(mesh.material.color).toEqual(expected);
    expect(mesh.parent!.visible).toBe(index < 2);
  });
  renderer.image(new Set(document.bricks.map(part => part.id)), step);
  meshes.forEach((mesh, index) => expect(mesh.material.color).toEqual(new Color(document.bricks[index].color)));
  const disposals = [...new Set(meshes.map(mesh => mesh.geometry)), ...meshes.map(mesh => mesh.material)]
    .map(resource => vi.spyOn(resource, "dispose"));
  renderer.dispose(); renderer.dispose();
  disposals.forEach(dispose => expect(dispose).toHaveBeenCalledOnce());
  expect(rendererDispose).toHaveBeenCalledOnce();
  expect(forceContextLoss).toHaveBeenCalledOnce();
});

it("releases cached WebGL geometry and occurrence materials after a later preparation failure", async () => {
  const { canvas } = stubCanvas();
  const actual = await vi.importActual<typeof import("../engine/local-brick-geometry")>("../engine/local-brick-geometry");
  const geometry = actual.createLocalBrickGeometry("brick-2x2");
  const dispose = vi.spyOn(geometry, "dispose");
  vi.mocked(createLocalBrickGeometry).mockReturnValueOnce(geometry).mockImplementationOnce(() => {
    throw new Error("geometry failed");
  });
  const document = repeatedDocument(2);
  document.bricks[1].type = "brick-1x2";
  await expect(createInstructionRenderer(document)).rejects.toThrow("geometry failed");
  expect(dispose).toHaveBeenCalledOnce();
  expect(rendererDispose).toHaveBeenCalledOnce();
  expect(forceContextLoss).toHaveBeenCalledOnce();
  expect([canvas.width, canvas.height]).toEqual([1, 1]);
});

it("builds and flattens software geometry once per type without sharing occurrence visibility", async () => {
  const { context } = stubCanvas();
  const flatten = vi.spyOn(BufferGeometry.prototype, "toNonIndexed");
  const document = repeatedDocument(3);
  const renderer = await createSoftwareInstructionRenderer(document);
  try {
    expect(createLocalBrickGeometry).toHaveBeenCalledOnce();
    expect(flatten).toHaveBeenCalledOnce();
    const step = { id: "s", title: "", notes: "", partIds: [] };
    renderer.image(new Set([document.bricks[0].id]), step);
    const trianglesPerBrick = context.fill.mock.calls.length;
    expect(trianglesPerBrick).toBeGreaterThan(100);
    context.fill.mockClear();
    renderer.image(new Set(document.bricks.map(part => part.id)), step, new Set([document.bricks[1].id]));
    expect(context.fill).toHaveBeenCalledTimes(trianglesPerBrick * 3);
    expect(context.stroke).toHaveBeenCalledOnce();
    context.fill.mockClear(); context.stroke.mockClear();
    renderer.image(new Set(), step, new Set([document.bricks[1].id]));
    expect(context.fill).not.toHaveBeenCalled();
    expect(context.stroke).not.toHaveBeenCalled();
  } finally { renderer.dispose(); flatten.mockRestore(); }
});

it("keeps the software triangle budget per occurrence and releases every allocated geometry once", async () => {
  const { canvas } = stubCanvas();
  const disposed: BufferGeometry[] = [];
  const dispose = vi.spyOn(BufferGeometry.prototype, "dispose").mockImplementation(function (this: BufferGeometry) {
    disposed.push(this);
  });
  try {
    await expect(createSoftwareInstructionRenderer(repeatedDocument(500))).rejects.toThrow(
      "PDF: WebGL ist nicht verfügbar und dieses Modell ist für die vollständige Software-Abbildung zu groß.",
    );
    expect(createLocalBrickGeometry).toHaveBeenCalledOnce();
    expect(disposed.length).toBeGreaterThan(2);
    expect(new Set(disposed).size).toBe(disposed.length);
    expect([canvas.width, canvas.height]).toEqual([1, 1]);
  } finally { dispose.mockRestore(); }
});

it("compares repeated-brick geometry preparation time and allocations with the former per-occurrence path", async () => {
  const actual = await vi.importActual<typeof import("../engine/local-brick-geometry")>("../engine/local-brick-geometry");
  const count = 128;
  const measure = (software: boolean, reuse: boolean) => {
    let allocations = 0;
    const dispose = vi.spyOn(BufferGeometry.prototype, "dispose").mockImplementation(() => { allocations++; });
    const started = performance.now();
    try {
      // Every allocated geometry in this fixture has exactly one owner/disposal.
      const templates = new Map<string, BufferGeometry>();
      for (let index = 0; index < count; index++) {
        let geometry = reuse ? templates.get("brick-2x2") : undefined;
        if (!geometry) {
          geometry = actual.createLocalBrickGeometry("brick-2x2");
          if (software) {
            const flat = geometry.toNonIndexed();
            geometry.dispose();
            geometry = flat;
          }
          if (reuse) templates.set("brick-2x2", geometry);
        }
        if (!reuse) geometry.dispose();
      }
      for (const geometry of templates.values()) geometry.dispose();
      return { milliseconds: performance.now() - started, geometryAllocations: allocations };
    } finally { dispose.mockRestore(); }
  };
  // Warm up both code paths; timing is evidence, not a flaky pass/fail threshold.
  measure(false, true); measure(true, true);
  for (const software of [false, true]) {
    const before = measure(software, false), after = measure(software, true);
    console.info(`${software ? "Software" : "WebGL"} geometry preparation (${count} identical bricks):`,
      JSON.stringify({ before, after }));
    expect(before.geometryAllocations).toBe(after.geometryAllocations * count);
    expect(after.geometryAllocations).toBe(software ? 7 : 6);
  }
});

it("uses print-resolution dimensions for the software PDF renderer", async () => {
  const canvas = { width: 0, height: 0, getContext: () => ({
    fillRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, closePath() {}, fill() {},
  }), toDataURL: () => "data:image/jpeg;base64,software" };
  vi.stubGlobal("document", { createElement: () => canvas });
  const renderer = await createSoftwareInstructionRenderer(createEmptyDocument());
  try {
    expect(canvas.width).toBe(2000);
    expect(canvas.height).toBe(1520);
  } finally { renderer.dispose(); }
});

it("unions imported material batches before outlining groups in the WebGL PDF path", async () => {
  const document = createEmptyDocument();
  const sourceText = [0, 40, 80, 120, 240].map(x => `1 4 ${x} 0 0 1 0 0 0 1 0 0 0 1 test.dat`).join("\n");
  document.imported = { version: 1, format: "mpd", sourceName: "test.mpd", sourceText, originalBytes: [],
    ...parseLDraw(sourceText), resources: {
      "parts/test.dat": { path: "parts/test.dat", source: "embedded",
        content: "0 Test\n4 16 -20 0 -20 20 0 -20 20 -24 -20 -20 -24 -20\n4 14 -20 0 20 20 0 20 20 -24 20 -20 -24 20" },
    }, legalDocuments: [] };
  document.imported.instances.forEach(part => { part.part.status = "resolved"; });
  document.bricks = [0, 2, 4, 6].map((x, i) =>
    ({ id: `local-${i}`, type: "brick-2x2", color: "#ff0000", x, y: 0, z: 8, rotation: 0 }));
  const context = { drawImage: vi.fn(), save: vi.fn(), restore: vi.fn(), beginPath: vi.fn(),
    moveTo: vi.fn(), lineTo: vi.fn(), stroke: vi.fn(), strokeStyle: "", lineWidth: 0, globalAlpha: 1 };
  vi.stubGlobal("document", { createElement: () => ({
    width: 0, height: 0, getContext: () => context, toDataURL: () => "data:image/jpeg;base64,outlined",
  }) });
  const ids = [...document.imported.instances.map(part => part.id), ...document.bricks.map(part => part.id)];
  const before = JSON.stringify(document);
  const renderer = await createInstructionRenderer(document);
  try {
    for (const rotation of [[0, 0, 0], [20, 65, -15]] as [number, number, number][]) {
      context.stroke.mockClear(); context.lineTo.mockClear();
      renderer.image(new Set(ids), { id: "s", title: "", notes: "", partIds: ids, rotation }, new Set(ids));
      expect(context.stroke).toHaveBeenCalledTimes(3); // Two imported clusters + one local cluster.
      expect(context.lineTo).toHaveBeenCalledTimes(36);
    }
    let batches = 0;
    (frames.mock.lastCall![0] as Scene).traverse(object => {
      if (object instanceof InstancedMesh) batches++;
    });
    expect(batches).toBe(2);
    context.stroke.mockClear();
    renderer.image(new Set(ids), { id: "s", title: "", notes: "", partIds: ids });
    expect(context.stroke).not.toHaveBeenCalled();
    context.drawImage.mockClear();
    const snapshot = renderer.image(new Set(ids), { id: "s", title: "", notes: "", partIds: ids });
    expect(context.drawImage).toHaveBeenCalledOnce();
    expect(snapshot).toBe("data:image/jpeg;base64,outlined");
    renderer.image(new Set([ids[0]]), { id: "s", title: "", notes: "", partIds: ids }, new Set(ids));
    expect(context.stroke).toHaveBeenCalledOnce();
    expect(JSON.stringify(document)).toBe(before);
  } finally { renderer.dispose(); }
});

it("releases the WebGL renderer and context when PDF setup is canceled during imported geometry", async () => {
  const document = createEmptyDocument("Canceled WebGL export");
  const sourceText = "1 4 0 0 0 1 0 0 0 1 0 0 0 1 test.dat";
  const imported = {
    version: 1 as const, format: "mpd" as const, sourceName: "test.mpd", sourceText,
    originalBytes: [], ...parseLDraw(sourceText),
    resources: {
      "parts/test.dat": {
        path: "parts/test.dat", source: "embedded" as const,
        content: "0 Test triangle\n3 16 0 0 0 20 0 0 0 20 0",
      },
    },
    legalDocuments: [],
  };
  imported.instances.forEach(instance => { instance.part.status = "resolved"; });
  document.imported = imported;
  const partId = imported.instances[0].id;
  const plan = {
    version: 1 as const, edited: false, source: "ldraw" as const, warnings: [],
    steps: [{ id: "step", title: "Step", notes: "", partIds: [partId] }],
  };
  const controller = new AbortController();
  const canvas = { width: 0, height: 0, getContext: () => null, toDataURL: () => "data:image/jpeg;base64,test" };
  vi.stubGlobal("document", { createElement: () => canvas });
  let elapsed = 0;
  const now = vi.spyOn(performance, "now").mockImplementation(() => (elapsed += 7));
  let geometryPreparationYielded = false;
  vi.stubGlobal("setTimeout", (callback: () => void) => {
    geometryPreparationYielded = true;
    controller.abort();
    queueMicrotask(callback);
    return 0;
  });

  try {
    await expect(exportInstructionPDF(document, plan, { signal: controller.signal })).rejects.toThrow();
    expect(geometryPreparationYielded).toBe(true);
    expect(rendererDispose).toHaveBeenCalledOnce();
    expect(forceContextLoss).toHaveBeenCalledOnce();
  } finally {
    now.mockRestore();
    vi.unstubAllGlobals();
  }
});
