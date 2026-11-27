import { afterEach, expect, it, vi } from "vitest";
import { Box3, BufferGeometry, Color, InstancedMesh, LineSegments, LineBasicMaterial, Matrix4, Mesh, ShaderMaterial, Vector3, type Camera, type Scene } from "three";
import { createEmptyDocument, type BuilderDocument } from "../editor/model";
import { createLocalBrickGeometry } from "../engine/local-brick-geometry";
import { brickTransformMatrix } from "../editor/brick-transform";
import { createSoftwareInstructionRenderer } from "./software-render";
import { parseLDraw } from "../formats/ldraw/parser";
import { createInstructionRenderer, INSTRUCTION_PDF_EDGE_WIDTH_PX } from "./render";
import { exportInstructionPDF } from "./pdf";
import { instructionDisplayColor } from "./highlight-color";
import { NORMAL_EDGE_CONTRAST } from "../engine/wide-lines";
import type { StudioModelArrow } from "./studio-objects";

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
    closePath() {}, fill() { softwareFaces.push(path.slice()); }, stroke() {},
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

it("fits and projects model-space arrows with the same camera as the model", async () => {
  const strokes: number[][] = [];
  let path: number[] = [];
  const context = {
    fillRect() {}, drawImage() {}, save() {}, restore() {}, closePath() {},
    beginPath() { path = []; },
    moveTo(x: number, y: number) { path.push(x, y); },
    lineTo(x: number, y: number) { path.push(x, y); },
    stroke() { strokes.push(path.slice()); }, fill() {},
  } as unknown as CanvasRenderingContext2D;
  vi.stubGlobal("document", { createElement: () => ({
    width: 0, height: 0, getContext: () => context, toDataURL: () => "data:image/png;base64,test",
  }) });
  const renderer = await createSoftwareInstructionRenderer(createEmptyDocument());
  const arrow: StudioModelArrow = {
    points: [[-12, 0, 0], [12, 0, 0]], startStyle: "TriangleEmpty",
    endStyle: "TriangleFilled", thickness: 2, color: "0 0 1 0.5",
  };
  try {
    renderer.image(new Set(), { id: "arrows", title: "", notes: "", partIds: [] }, undefined, 1, [arrow]);
    const shaft = strokes[0];
    expect(shaft).toHaveLength(4);
    expect(shaft.every(Number.isFinite)).toBe(true);
    expect(shaft[0]).toBeGreaterThanOrEqual(0);
    expect(shaft[0]).toBeLessThanOrEqual(2000);
    expect(shaft[2]).toBeGreaterThanOrEqual(0);
    expect(shaft[2]).toBeLessThanOrEqual(2000);
    expect(Math.abs(shaft[0] - shaft[2])).toBeGreaterThan(100);
  } finally {
    renderer.dispose();
  }
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
    toDataURL: vi.fn(() => "data:image/png;base64,test") };
  vi.stubGlobal("document", { createElement: () => canvas });
  return { canvas, context };
}

it("excludes compact line batches as well as wide edges from every highlight mask and restores visibility", async () => {
  stubCanvas();
  const doc = repeatedDocument(2);
  const renderer = await createInstructionRenderer(doc);
  const visible = new Set(doc.bricks.map(part => part.id));
  const step = { id: "s", title: "", notes: "", partIds: [...visible] };
  try {
    renderer.image(visible, step);
    const scene = frames.mock.lastCall![0] as Scene;
    const compact = new LineSegments(new BufferGeometry(), new LineBasicMaterial());
    const hidden = compact.clone();
    hidden.visible = false;
    scene.traverse(object => {
      if (object.userData.partId === doc.bricks[0].id) object.parent!.add(compact, hidden);
    });
    let masks = 0;
    frames.mockImplementationOnce(() => {}).mockImplementationOnce((rendered: Scene) => {
      expect(rendered.overrideMaterial).not.toBeNull();
      expect(compact.visible).toBe(false);
      expect(hidden.visible).toBe(false);
      rendered.traverse(object => {
        if (object instanceof Mesh && object.userData.isWideEdgeMesh) expect(object.visible).toBe(false);
      });
      masks++;
    });
    renderer.image(visible, step, new Set([doc.bricks[1].id]), 1, [], undefined, { silhouetteHighlight: true });
    expect(masks).toBe(1);
    expect(compact.visible).toBe(true);
    expect(hidden.visible).toBe(false);
    compact.geometry.dispose(); compact.material.dispose();
  } finally { renderer.dispose(); }
});

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
    if (object instanceof Mesh && object.parent?.userData.partId) meshes.push(object as typeof meshes[number]);
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
  const { canvas, context } = stubCanvas();
  const flatten = vi.spyOn(BufferGeometry.prototype, "toNonIndexed");
  const document = repeatedDocument(3);
  const renderer = await createSoftwareInstructionRenderer(document);
  try {
    expect(createLocalBrickGeometry).toHaveBeenCalledOnce();
    expect(flatten).toHaveBeenCalledOnce();
    const step = { id: "s", title: "", notes: "", partIds: [] };
    renderer.image(new Set([document.bricks[0].id]), step);
    expect(canvas.toDataURL).toHaveBeenCalledWith("image/png");
    const trianglesPerBrick = context.fill.mock.calls.length;
    expect(trianglesPerBrick).toBeGreaterThan(100);
    context.fill.mockClear();
    renderer.image(new Set(document.bricks.map(part => part.id)), step, new Set([document.bricks[1].id]));
    expect(context.fill).toHaveBeenCalledTimes(trianglesPerBrick * 3);
    expect(context.stroke).toHaveBeenCalled();
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
  const outputCanvas = { width: 0, height: 0, getContext: () => context,
    toDataURL: vi.fn(() => "data:image/png;base64,outlined") };
  vi.stubGlobal("document", { createElement: () => outputCanvas });
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
    let configuredEdges = 0;
    (frames.mock.lastCall![0] as Scene).traverse(object => {
      if (!(object instanceof Mesh) || !object.userData.isWideEdgeMesh ||
        !(object.material instanceof ShaderMaterial)) return;
      expect(object.material.uniforms.resolution.value.toArray()).toEqual([2000, 1520]);
      expect(object.material.uniforms.lineWidth.value).toBe(INSTRUCTION_PDF_EDGE_WIDTH_PX);
      expect(object.material.uniforms.edgeContrast.value).toBe(NORMAL_EDGE_CONTRAST);
      configuredEdges++;
    });
    expect(configuredEdges).toBeGreaterThan(0);
    const localEdgeBatch = (frames.mock.lastCall![0] as Scene).getObjectByName("brick-edges-brick-2x2") as Mesh;
    expect(localEdgeBatch).toBeDefined();
    expect(localEdgeBatch.geometry.instanceCount).toBe(4);
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
    expect(snapshot).toBe("data:image/png;base64,outlined");
    expect(outputCanvas.toDataURL).toHaveBeenCalledWith("image/png");
    renderer.image(new Set([ids[0]]), { id: "s", title: "", notes: "", partIds: ids }, new Set(ids));
    expect(context.stroke).toHaveBeenCalledOnce();
    expect(JSON.stringify(document)).toBe(before);
  } finally { renderer.dispose(); }
});

it.each([
  { label: "step 5, rotated plate", partMatrix: "0 0 1 0 1 0 -1 0 0", rotation: [20, 65, -15] },
  { label: "step 6, tilted accessory", partMatrix: "0.707107 0 -0.707107 0.707107 0 0.707107 0 -1 0", rotation: [-35, 140, 12] },
])("rotates highlight corners with the model for $label in both PDF paths", async ({ partMatrix, rotation }) => {
  const document = createEmptyDocument();
  const sourceText = `1 4 47 -64 -41 ${partMatrix} test.dat`;
  document.imported = { version: 1, format: "io", sourceName: "synthetic.io", sourceText, originalBytes: [],
    ...parseLDraw(sourceText), resources: {
      "parts/test.dat": { path: "parts/test.dat", source: "embedded",
        content: [
          "4 16 -40 0 -10 40 0 -10 40 -8 -10 -40 -8 -10",
          "4 14 -40 0 10 40 0 10 40 -8 10 -40 -8 10",
        ].join("\n") },
    }, legalDocuments: [] };
  const part = document.imported.instances[0];
  part.part.status = "resolved";
  const paths: number[][] = [];
  let path: number[] = [];
  const context = {
    strokeStyle: "", globalAlpha: 1, lineWidth: 1, fillStyle: "",
    drawImage() {}, save() {}, restore() {}, fillRect() {}, fill() {}, closePath() {},
    beginPath() { path = []; },
    moveTo(x: number, y: number) { path.push(x, y); },
    lineTo(x: number, y: number) { path.push(x, y); },
    stroke() { if (this.strokeStyle === "#e32620") paths.push([...path]); },
  };
  vi.stubGlobal("document", { createElement: () => ({
    width: 0, height: 0, getContext: () => context, toDataURL: () => "data:image/png;base64,test",
  }) });
  const webgl = await createInstructionRenderer(document);
  const software = await createSoftwareInstructionRenderer(document);
  const ids = new Set([part.id]);
  const step = { id: "rotated", title: "", notes: "", partIds: [...ids], rotation: rotation as [number, number, number] };
  try {
    webgl.image(ids, step, ids);
    const [scene, camera] = frames.mock.lastCall! as [Scene, Camera];
    let transform: Matrix4 | undefined;
    scene.traverse(object => {
      if (object instanceof InstancedMesh && object.userData.brickIds?.includes(part.id)) {
        const instance = new Matrix4();
        object.getMatrixAt(0, instance);
        transform = object.matrixWorld.clone().multiply(instance);
      }
    });
    const local = new Box3(new Vector3(-40, -8, -10), new Vector3(40, 0, 10));
    const corners: Vector3[] = [];
    for (const x of [local.min.x, local.max.x]) for (const y of [local.min.y, local.max.y]) for (const z of [local.min.z, local.max.z]) {
      corners.push(new Vector3(x, y, z).applyMatrix4(transform!).project(camera));
    }
    const expected: number[] = [];
    for (let i = 0; i < 8; i++) for (const bit of [1, 2, 4]) {
      const j = i ^ bit;
      if (j < i) continue;
      for (const point of [corners[i], corners[j]]) expected.push((point.x + 1) * 1000, (1 - point.y) * 760);
    }
    expect(paths).toHaveLength(1);
    paths[0].forEach((value, index) => expect(value).toBeCloseTo(expected[index], 3));
    paths.length = 0;
    software.image(ids, step, ids);
    expect(paths).toHaveLength(1);
    paths[0].forEach((value, index) => expect(value).toBeCloseTo(expected[index], 3));
  } finally { webgl.dispose(); software.dispose(); }
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

it("fits only the visible Studio geometry into a narrow slot and keeps ordinary PDF cameras unchanged", async () => {
  const document = createEmptyDocument("Studio fit");
  document.bricks = [
    { id: "first", type: "brick-2x4", color: "#ff0000", x: 0, y: 0, z: 0, rotation: 25 },
    { id: "future", type: "brick-2x4", color: "#00ff00", x: 10000, y: 1000, z: 0, rotation: 0 },
  ];
  const softwarePoints: number[] = [];
  const canvases: { width: number; height: number }[] = [];
  const context = {
    fillRect() {}, drawImage() {}, beginPath() {}, closePath() {}, fill() {}, stroke() {}, save() {}, restore() {},
    moveTo(x: number, y: number) { softwarePoints.push(x, y); },
    lineTo(x: number, y: number) { softwarePoints.push(x, y); },
  };
  vi.stubGlobal("document", { createElement: () => {
    const canvas = { width: 0, height: 0, getContext: () => context, toDataURL: () => "data:image/png;base64,test" };
    canvases.push(canvas); return canvas;
  } });
  const webgl = await createInstructionRenderer(document);
  const software = await createSoftwareInstructionRenderer(document);
  const saved = {
    theta: 0.6, phi: 0.9, distance: 200, referenceDistance: 20,
    target: [40, 0, 50] as [number, number, number], referenceTarget: [0, 0, 0] as [number, number, number],
  };
  const step = { id: "fit", title: "", notes: "", partIds: ["first"], camera: saved, rotation: [10, 30, 0] as [number, number, number] };
  const before = JSON.stringify(document);
  try {
    const visible = new Set(["first"]);
    webgl.image(visible, step);
    const normalCamera = (frames.mock.lastCall![1] as import("three").OrthographicCamera).clone();
    const webglBounds = vi.fn(), softwareBounds = vi.fn();
    webgl.image(visible, step, undefined, 0.5, [], undefined, { onPartBounds: webglBounds });
    const [scene, camera] = frames.mock.lastCall! as [Scene, import("three").OrthographicCamera];
    expect(camera.zoom).toBe(1);
    expect(rendererSetSize).toHaveBeenLastCalledWith(1000, 2000);
    const points: Vector3[] = [];
    scene.traverse(object => {
      if (!(object instanceof Mesh) || object.parent?.userData.partId !== "first") return;
      const positions = object.geometry.getAttribute("position");
      for (let index = 0; index < positions.count; index++) {
        points.push(new Vector3().fromBufferAttribute(positions, index).applyMatrix4(object.matrixWorld).project(camera));
      }
    });
    const ndcX = points.map(point => point.x), ndcY = points.map(point => point.y);
    const expectedBounds = [(Math.min(...ndcX) + 1) / 2, (1 - Math.max(...ndcY)) / 2,
      (Math.max(...ndcX) - Math.min(...ndcX)) / 2, (Math.max(...ndcY) - Math.min(...ndcY)) / 2];
    expect([...webglBounds.mock.lastCall![0].keys()]).toEqual(["first"]);
    webglBounds.mock.lastCall![0].get("first").forEach((value: number, index: number) =>
      expect(value).toBeCloseTo(expectedBounds[index], 5));
    expect(Math.min(...ndcX)).toBeGreaterThan(-1);
    expect(Math.max(...ndcX)).toBeLessThan(1);
    expect(Math.min(...ndcY)).toBeGreaterThan(-1);
    expect(Math.max(...ndcY)).toBeLessThan(1);
    expect(Math.max(Math.max(...ndcX) - Math.min(...ndcX), Math.max(...ndcY) - Math.min(...ndcY))).toBeCloseTo(2 / 1.06, 5);
    const fittedProjection = camera.projectionMatrix.clone();
    const staleArrow: StudioModelArrow = {
      points: [[-10000, 5000, 0], [-9000, 5000, 0]], startStyle: "NoHeads",
      endStyle: "TriangleFilled", thickness: 2, color: "0 0 0",
    };
    webgl.image(visible, step, undefined, 0.5, [staleArrow]);
    expect(camera.projectionMatrix.equals(fittedProjection)).toBe(true);
    softwarePoints.length = 0;
    software.image(visible, step, undefined, 0.5, [], undefined, { onPartBounds: softwareBounds });
    expect([...softwareBounds.mock.lastCall![0].keys()]).toEqual(["first"]);
    softwareBounds.mock.lastCall![0].get("first").forEach((value: number, index: number) =>
      expect(value).toBeCloseTo(expectedBounds[index], 4));
    expect(canvases.at(-1)).toMatchObject({ width: 1000, height: 2000 });
    const xs = softwarePoints.filter((_, index) => index % 2 === 0).map(x => x / 500 - 1);
    const ys = softwarePoints.filter((_, index) => index % 2 === 1).map(y => 1 - y / 1000);
    expect(Math.min(...xs)).toBeCloseTo(Math.min(...ndcX), 4);
    expect(Math.max(...xs)).toBeCloseTo(Math.max(...ndcX), 4);
    expect(Math.min(...ys)).toBeCloseTo(Math.min(...ndcY), 4);
    expect(Math.max(...ys)).toBeCloseTo(Math.max(...ndcY), 4);
    const originalSoftwarePoints = softwarePoints.slice();
    softwarePoints.length = 0;
    software.image(visible, step, undefined, 0.5, [staleArrow]);
    expect(softwarePoints.slice(0, originalSoftwarePoints.length)).toEqual(originalSoftwarePoints);
    webgl.image(visible, step);
    const restored = frames.mock.lastCall![1] as import("three").OrthographicCamera;
    expect(restored.zoom).toBe(normalCamera.zoom);
    expect(restored.position.toArray()).toEqual(normalCamera.position.toArray());
    expect(restored.projectionMatrix.elements).toEqual(normalCamera.projectionMatrix.elements);
    expect(rendererSetSize).toHaveBeenLastCalledWith(2000, 1520);
    expect(JSON.stringify(document)).toBe(before);
  } finally { webgl.dispose(); software.dispose(); }
});
