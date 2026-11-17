// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { builderDatabase } from "@/storage/database";
import { thumbnailModel } from "./model";
import { compilePart } from "../../engine/ldraw-geometry";
import { createImportedGroup, disposeImportedScene } from "../../engine/imported-scene";
import type { InstalledPackage, LibraryFile, LibraryPart } from "../types";

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
