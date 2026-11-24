import { afterEach, describe, expect, it, vi } from "vitest";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { Color, InstancedBufferGeometry, InstancedMesh, LineSegments, Mesh, SRGBColorSpace } from "three";
import type { ImportedModel } from "../formats/types";
import { parseLDraw } from "../formats/ldraw/parser";
import { compilePart, createImportedGroup, hasCompiledPart, visibleEdgeCount } from "./ldraw-geometry";
import { createImportedGroupAsync, disposeImportedScene, importedSceneDetail, measureImportedScene, SceneBudgetExceeded } from "./imported-scene";
import { InstanceIndex } from "./instance-index";
import { prepareGeometry } from "./prepare-geometry";
import { createSoftwareScene, SOFTWARE_TRIANGLE_BUDGET } from "./software-scene";
import { importIO } from "../formats/io/import";
import { hashBytes } from "../formats/online-geometry";
import { builderDatabase } from "@/storage/database";

function fixture(count = 1): ImportedModel {
  const source = Array.from({ length: count }, (_, index) =>
    `1 ${["4", "14", "43"][index % 3]} ${(index % 100) * 20} 0 ${Math.floor(index / 100) * 20} 1 0 0 0 1 0 0 0 1 test.dat`).join("\n");
  const model: ImportedModel = {
    version: 1, format: "ldr", sourceName: "synthetic.ldr",
    originalBytes: [], sourceText: source, ...parseLDraw(source),
    resources: { "parts/test.dat": {
      path: "parts/test.dat", author: "Synthetic test author", license: "CC0-1.0", sourceUrl: "https://example.invalid/test.dat",
      content: `${"3 16 0 0 0 20 0 0 0 20 0\n".repeat(200)}3 2 0 0 0 0 20 0 0 0 20\n2 24 0 0 0 20 0 0`,
    } }, legalDocuments: [],
  };
  model.instances.forEach(instance => { instance.part.status = "resolved"; });
  return model;
}
function drawnFaces(root: Awaited<ReturnType<typeof createImportedGroupAsync>>) {
  return root.children.reduce((total, draw) => draw instanceof InstancedMesh
    ? total + (draw.geometry.index?.count ?? draw.geometry.getAttribute("position").count) / 3 * draw.count
    : total, 0);
}
afterEach(() => { vi.unstubAllGlobals(); });

describe("bounded large-model rendering", () => {
  it("shares typed geometry buffers across different inherited colors", () => {
    const model = fixture();
    const red = compilePart(model, "test.dat", "4");
    const yellow = compilePart(model, "TEST.DAT", "14");
    expect(red[0].positions).toBeInstanceOf(Float32Array);
    expect(red[0].positions).toBe(yellow[0].positions);
    expect(red[0].normals).toBe(yellow[0].normals);
    expect(red[0].colorCode).toBe("4");
    expect(yellow[0].colorCode).toBe("14");
    expect(red.find(surface => surface.colorCode === "2")).toBe(yellow.find(surface => surface.colorCode === "2"));
  });
  it("renders 10,000 multicolor instances using four draws, including one instanced edge object", () => {
    const model = fixture(10_000), started = performance.now();
    const root = createImportedGroup(model);
    const stats = measureImportedScene(root);
    expect(stats.drawObjects).toBe(4); // Two inherited alpha groups, fixed paint, edges.
    expect(stats.bufferBytes).toBeLessThan(2 * 1024 * 1024);
    const edges = root.children.filter(child => child instanceof Mesh && child.userData.isWideEdgeMesh);
    expect(edges).toHaveLength(1);
    expect(edges[0].geometry).toBeInstanceOf(InstancedBufferGeometry);
    expect((edges[0].geometry as InstancedBufferGeometry).instanceCount).toBe(10_000);
    const inherited = root.children.filter(child => child instanceof InstancedMesh && child.instanceColor) as InstancedMesh[];
    expect(inherited[0].geometry.getAttribute("position")).toBe(inherited[1].geometry.getAttribute("position"));
    const color = new Color(); inherited[0].getColorAt(0, color);
    expect(color.getHexString(SRGBColorSpace)).toBe("b40000");
    console.info(JSON.stringify({ syntheticRenderer: { ...stats, sceneMilliseconds: Math.round(performance.now() - started) } }));
    const disposals = root.children.filter(child => child instanceof InstancedMesh).map(mesh => vi.spyOn(mesh, "dispose"));
    disposeImportedScene(root);
    disposals.forEach(dispose => expect(dispose).toHaveBeenCalledOnce());
    expect(root.children).toHaveLength(0);
  });
  it("derives visible crease lines for imported parts without authored LDraw edge lines", async () => {
    const model = fixture();
    model.resources["parts/test.dat"].content = model.resources["parts/test.dat"].content
      .replace(/\n2 24[^\n]*$/, "");
    const root = createImportedGroup(model);
    const edgeObject = root.getObjectByName("ldraw:instanced-edges") as Mesh;
    expect(edgeObject).toBeDefined();
    expect(edgeObject.geometry.getAttribute("lineEnd").count).toBeGreaterThan(0);

    const software = await createSoftwareScene(model);
    expect(software.records.get(model.instances[0].id)?.localEdges.length).toBeGreaterThan(0);
    disposeImportedScene(root);
  });
  it("aborts partial builds and rejects an over-budget scene before GPU upload", async () => {
    const model = fixture(100);
    await expect(createImportedGroupAsync(model, { maxGeometryBytes: 128 })).rejects.toBeInstanceOf(SceneBudgetExceeded);
    const controller = new AbortController();
    await expect(createImportedGroupAsync(model, {
      signal: controller.signal, onProgress: () => controller.abort(),
    })).rejects.toMatchObject({ name: "AbortError" });
    const root = await createImportedGroupAsync(model);
    expect(root.children).toHaveLength(4);
    disposeImportedScene(root);
  });
  it("packs faces and uses thin black GPU lines rather than dropping triangles when edges exceed the budget", async () => {
    const model = fixture(100);
    model.resources["parts/test.dat"].content += "\n" +
      "3 16 0 0 0 20 0 0 0 20 0\n".repeat(200) + "2 24 0 0 0 0 20 0\n".repeat(80);
    const budget = 30 * 1024;
    const root = await createImportedGroupAsync(model, { maxGeometryBytes: budget, viewport: "standard" });
    try {
      expect(importedSceneDetail(root)).toEqual({ compactFaces: true, edges: "thin" });
      expect(measureImportedScene(root).bufferBytes).toBeLessThanOrEqual(budget);
      expect(drawnFaces(root)).toBe(40_100);
      const faces = root.children.find(child => child instanceof InstancedMesh && child.userData.inherited) as InstancedMesh;
      expect(faces.geometry.getAttribute("position").count).toBe(3);
      expect(faces.geometry.getAttribute("normal").normalized).toBe(true);
      expect(faces.geometry.index?.count).toBe(1_200);
      expect(root.getObjectByName("ldraw:instanced-edges")).toBeInstanceOf(LineSegments);
      // Changing alpha keeps the editing index and compact draws in sync.
      const next = { ...model, instances: model.instances.map(part =>
        part.id === model.instances[0].id ? { ...part, colorCode: "47" } : part) };
      const index = new InstanceIndex(root, model, budget * 2);
      expect(index.update(next)).toBe(true);
      expect(index.bounds(next.instances[0].id)?.isEmpty()).toBe(false);
      expect(drawnFaces(root)).toBe(40_100);
    } finally { disposeImportedScene(root); }
  });
  it("limits shaded edge work even when instanced edge buffers fit", async () => {
    const model = fixture(7_000);
    model.resources["parts/test.dat"].content += "\n" + "2 24 0 0 0 0 20 0\n".repeat(80);
    const root = await createImportedGroupAsync(model, { viewport: "standard" });
    try {
      expect(importedSceneDetail(root).edges).toBe("thin");
      expect(drawnFaces(root)).toBe(1_407_000);
      expect(root.getObjectByName("ldraw:instanced-edges")).toBeInstanceOf(LineSegments);
    } finally { disposeImportedScene(root); }
  });
  it("bounds the software preview while preserving the full model and source", async () => {
    const model = fixture(10_000);
    const source = model.sourceText, started = performance.now();
    const scene = await createSoftwareScene(model);
    expect(scene.sourceTriangles).toBe(2_010_000);
    expect(scene.triangleCount).toBeLessThanOrEqual(SOFTWARE_TRIANGLE_BUDGET);
    expect(scene.positions.byteLength).toBeLessThanOrEqual(SOFTWARE_TRIANGLE_BUDGET * 9 * 4);
    expect(scene.colors).toHaveLength(scene.triangleCount);
    expect(scene.bounds.isEmpty()).toBe(false);
    expect(model.instances).toHaveLength(10_000);
    expect(model.sourceText).toBe(source);
    console.info(JSON.stringify({ syntheticSoftware: {
      sourceTriangles: scene.sourceTriangles, previewTriangles: scene.triangleCount,
      prepareMilliseconds: Math.round(performance.now() - started),
    } }));
  });
  it("sends only source resources and unique references to the compiler worker", async () => {
    const model = fixture(100);
    const terminate = vi.fn(), payloads: unknown[] = [];
    class CompilerWorker {
      onmessage?: (event: MessageEvent) => void;
      onerror?: (event: ErrorEvent) => void;
      terminate = terminate;
      postMessage(payload: { references: string[]; resources: ImportedModel["resources"] }) {
        payloads.push(payload);
        queueMicrotask(() => {
          const workerModel = { resources: payload.resources } as ImportedModel;
          for (const reference of payload.references) this.onmessage?.({
            data: { kind: "part", reference, surfaces: compilePart(workerModel, reference, "16") },
          } as MessageEvent);
          this.onmessage?.({ data: { kind: "done" } } as MessageEvent);
        });
      }
    }
    vi.stubGlobal("Worker", CompilerWorker);
    await prepareGeometry(model);
    expect(Object.keys(payloads[0] as object).sort()).toEqual(["references", "resources"]);
    expect((payloads[0] as { references: string[] }).references).toEqual(["test.dat"]);
    expect(hasCompiledPart(model, "test.dat")).toBe(true);
    expect(terminate).toHaveBeenCalledOnce();
  });
});

const privateReference = new URL("../../../../../attached_assets/40649-size_1793502923137.io", import.meta.url);

const largeModelPath = process.env.BRICKBUILDER_LARGE_IO;
it.skipIf(!largeModelPath)("keeps every resolved triangle of a local Studio model within the Android graphics budget", async () => {
  const base = process.env.BRICKBUILDER_BENCH_URL;
  const nativeFetch = globalThis.fetch;
  if (base) {
    vi.stubGlobal("window", { location: { href: base } });
    vi.stubGlobal("fetch", (input: string | URL | Request, init?: RequestInit) =>
      nativeFetch(new URL(String(input), base), init));
  }
  await builderDatabase.open();
  try {
    const bytes = new Uint8Array(await readFile(largeModelPath!));
    const model = (await importIO(bytes, "private-reference.io", { online: !!base })).imported!;
    const counts = new Map<string, number>();
    for (const part of model.instances) {
      if (part.part.status === "resolved") counts.set(part.reference, (counts.get(part.reference) ?? 0) + 1);
    }
    let segments = 0, repeatedSegments = 0, faces = 0, uniqueFaceBytes = 0;
    for (const [reference, count] of counts) {
      const surfaces = compilePart(model, reference, "16");
      const partSegments = visibleEdgeCount(surfaces);
      segments += partSegments;
      repeatedSegments += partSegments * count;
      for (const surface of surfaces) {
        faces += surface.positions.length / 9 * count;
        uniqueFaceBytes += surface.positions.byteLength + surface.normals.byteLength;
      }
    }
    const budget = 32 * 1024 * 1024;
    const group = await createImportedGroupAsync(model, { maxGeometryBytes: budget, viewport: "standard" });
    try {
      const stats = measureImportedScene(group);
      const resolved = model.instances.filter(instance => instance.part.status === "resolved").length;
      expect(resolved).toBeGreaterThan(0);
      expect(drawnFaces(group)).toBe(faces);
      expect(stats.bufferBytes).toBeLessThanOrEqual(budget);
      expect(new InstanceIndex(group, model, budget).records.size).toBe(model.instances.length);
      console.info({ parts: model.instances.length, resolved, unique: counts.size, faces, uniqueFaceBytes, segments, repeatedSegments,
        ...stats, ...importedSceneDetail(group) });
    } finally { disposeImportedScene(group); }
  } finally { await builderDatabase.delete(); }
}, 240000);

describe.skipIf(!process.env.BRICKBUILDER_BENCH_URL || !existsSync(privateReference))("private reference performance", () => {
  it("measures the real encrypted 8,590-instance IO model with verified archive geometry", async () => {
    const nativeFetch = globalThis.fetch;
    vi.stubGlobal("fetch", (input: string | URL | Request, init?: RequestInit) =>
      nativeFetch(new URL(String(input), process.env.BRICKBUILDER_BENCH_URL), init));
    await builderDatabase.open();
    try {
      const bytes = new Uint8Array(await readFile(privateReference));
      const document = await importIO(bytes, "private-reference.io", { retry: true });
      const model = document.imported!;
      expect(model.instances).toHaveLength(8590);
      expect(model.originalBytes).toHaveLength(bytes.length);
      const start = performance.now();
      const root = await createImportedGroupAsync(model);
      const stats = measureImportedScene(root);
      const resolved = model.instances.filter(instance => instance.part.status === "resolved");
      const legacyBatches = new Map<string, typeof resolved>();
      for (const instance of resolved) {
        const key = `${instance.reference.toLowerCase()}|${instance.colorCode}`;
        const batch = legacyBatches.get(key) ?? [];
        batch.push(instance); legacyBatches.set(key, batch);
      }
      let previousDrawObjects = 0, previousBufferBytes = 0, renderedTriangles = 0;
      for (const instances of legacyBatches.values()) {
        const surfaces = compilePart(model, instances[0].reference, instances[0].colorCode);
        const paints = new Map<string, { vertices: number; edges: number }>();
        for (const surface of surfaces) {
          const paint = paints.get(surface.colorCode) ?? { vertices: 0, edges: 0 };
          paint.vertices += surface.positions.length; paint.edges += surface.edges.length;
          paints.set(surface.colorCode, paint);
        }
        for (const paint of paints.values()) {
          if (paint.vertices) previousDrawObjects++;
          if (paint.edges) previousDrawObjects += instances.length;
          previousBufferBytes += paint.vertices * 8 + paint.edges * 4 + (paint.vertices ? instances.length * 64 : 0);
          renderedTriangles += paint.vertices / 9 * instances.length;
        }
      }
      expect(resolved.length).toBeGreaterThan(8000);
      expect(stats.drawObjects).toBeLessThan(resolved.length / 3);
      expect(stats.bufferBytes).toBeLessThan(96 * 1024 * 1024);
      console.info(JSON.stringify({ privateReferenceRenderer: {
        instances: model.instances.length, resolved: resolved.length, ...stats,
        previousDrawObjects, previousBufferBytes, renderedTriangles,
        sceneMilliseconds: Math.round(performance.now() - start),
      } }));
      expect(await hashBytes(Uint8Array.from(model.originalBytes))).toBe(await hashBytes(bytes));
      expect(model.instances).toHaveLength(8590);
      disposeImportedScene(root);
    } finally { await builderDatabase.delete(); }
  }, 120000);
});
