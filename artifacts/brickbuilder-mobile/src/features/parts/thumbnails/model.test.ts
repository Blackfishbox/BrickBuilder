// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { builderDatabase } from "@/storage/database";
import { thumbnailModel } from "./model";
import { compilePart } from "../../engine/ldraw-geometry";
import { createImportedGroup, disposeImportedScene } from "../../engine/imported-scene";
import type { InstalledPackage, LibraryFile, LibraryPart } from "../types";
import { cachedThumbnailSource } from "./snapshot-source";

afterEach(async () => { vi.unstubAllGlobals(); await builderDatabase.delete(); });
const file = (path: string, content: string): LibraryFile => ({
  path, content, author: "Synthetic test fixture", license: "CC0-1.0",
  sourceUrl: `https://library.ldraw.org/library/official/${path}`,
});
async function install(id: string, files: LibraryFile[]) {
  await builderDatabase.open();
  await builderDatabase.partPackages.put({ id, version: "1", sha256: "fixture" } as InstalledPackage);
  await builderDatabase.libraryFiles.bulkPut(files.map(f => ({ ...f, id: `${id}:${f.path}`, packageId: id })));
  return {
    id: `${id}:test`, packageId: id, ldrawId: "test", file: "parts/test.dat",
    name: "Synthetic part", category: "", keywords: [],
  } satisfies LibraryPart;
}

it("compiles installed dependencies offline without touching catalog or network", async () => {
  vi.stubGlobal("Worker", undefined);
  const fetch = vi.fn(() => { throw new Error("Unexpected network"); });
  vi.stubGlobal("fetch", fetch);
  const part = await install("offline-thumb", [
    file("parts/test.dat", "1 16 0 0 0 1 0 0 0 1 0 0 0 1 child.dat"),
    file("parts/child.dat", "3 16 0 0 0 20 0 0 0 -20 0\n3 4 0 0 0 0 0 20 20 0 0"),
  ]);
  const model = await thumbnailModel(part, "1:fixture", new AbortController().signal);
  expect(Object.keys(model.resources)).toHaveLength(2);
  expect(compilePart(model, part.file, "1").map(surface => surface.colorCode)).toEqual(["1", "4"]);
  expect(await thumbnailModel(part, "1:fixture", new AbortController().signal)).toBe(model);
  expect(fetch).not.toHaveBeenCalled();
  const transparent = { ...model, instances: model.instances.map(instance => ({ ...instance, colorCode: "47" })) };
  const scene = createImportedGroup(transparent);
  try {
    const inherited = scene.children.find(child => child.userData.inherited)!;
    const fixed = scene.children.find(child => child.userData.inherited === false)!;
    expect((inherited as any).material.opacity).toBeCloseTo(128 / 255);
    expect((fixed as any).material.opacity).toBe(1);
  } finally { disposeImportedScene(scene); }
});

it("rejects missing local dependencies and changed package revisions", async () => {
  vi.stubGlobal("Worker", undefined);
  const part = await install("missing-thumb", [file("parts/test.dat", "1 16 0 0 0 1 0 0 0 1 0 0 0 1 absent.dat")]);
  await expect(thumbnailModel(part, "1:fixture", new AbortController().signal)).rejects.toThrow("Vorschaugeometrie fehlt");
  await expect(thumbnailModel(part, "outdated", new AbortController().signal)).rejects.toThrow("erneut öffnen");
});

it("rejects corrupted acquired geometry and never downloads missing dependencies", async () => {
  vi.stubGlobal("Worker", undefined);
  const fetch = vi.fn(() => { throw new Error("Unexpected network"); });
  vi.stubGlobal("fetch", fetch);
  await builderDatabase.open();
  const root = file("parts/cached-corrupt.dat", "3 16 0 0 0 20 0 0 0 -20 0");
  await builderDatabase.geometrySnapshots.put({
    version: 1, id: "corrupt-thumbnail", createdAt: "2026-11-17", roots: ["cached-corrupt.dat"],
    graph: {}, legalDocuments: [], files: [{ ...root, sha256: "0".repeat(64), byteLength: root.content.length }],
  });
  const source = (await cachedThumbnailSource("cached-corrupt"))!;
  await expect(thumbnailModel(source.part, source.revision, new AbortController().signal)).rejects.toThrow("Beschädigte");
  await builderDatabase.geometrySnapshots.put({
    version: 1, id: "incomplete-thumbnail", createdAt: "2026-11-18", roots: ["cached-missing.dat"],
    graph: {}, legalDocuments: [], files: [file("parts/cached-missing.dat", "1 16 0 0 0 1 0 0 0 1 0 0 0 1 missing.dat")],
  });
  const missing = (await cachedThumbnailSource("cached-missing"))!;
  await expect(thumbnailModel(missing.part, missing.revision, new AbortController().signal)).rejects.toThrow("Vorschaugeometrie fehlt");
  await builderDatabase.geometrySnapshots.delete("incomplete-thumbnail");
  await expect(thumbnailModel(missing.part, missing.revision, new AbortController().signal)).rejects.toThrow("nicht mehr verfügbar");
  expect(fetch).not.toHaveBeenCalled();
});
