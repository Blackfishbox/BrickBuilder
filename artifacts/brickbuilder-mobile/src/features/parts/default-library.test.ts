import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { gunzipSync } from "fflate";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { builderDatabase, loadCurrentProject, saveProject } from "@/storage/database";
import { createEmptyDocument } from "../editor/model";
import { placePreparedPart, prepareLibraryPart } from "../editor/ldraw-editing";
import { importLDraw } from "../formats/ldraw/import";
import { compilePart } from "../engine/ldraw-geometry";
import { ensureBundledPackages, installPackage, PART_PACKAGES, searchLocalParts, validatePayload } from "./library";

function assets() {
  // Only bundled, same-origin asset requests work. No internet/API fallback.
  const fetcher = vi.fn(async (url: string | URL | Request) => {
    const path = String(url).replace(/^.*?parts\//, "parts/");
    if (!path.startsWith("parts/") || path.includes("..")) throw new Error(`Offline: ${url}`);
    return new Response(readFileSync(resolve("public", path)));
  });
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
}

beforeEach(async () => { await builderDatabase.open(); });
afterEach(async () => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  await builderDatabase.delete();
});

it("initializes 357 additional physical roots offline, compiles every root and persists representative placements", async () => {
  const fetcher = assets();
  await Promise.all([ensureBundledPackages(), ensureBundledPackages()]);
  expect(fetcher).toHaveBeenCalledTimes(PART_PACKAGES.length);
  const parts = await searchLocalParts();
  expect(parts).toHaveLength(369);
  expect(new Set(parts.map(part => part.ldrawId)).size).toBe(369);
  const additions = parts.filter(part => part.packageId.startsWith("ldraw-default-"));
  expect(additions).toHaveLength(357);
  expect(new Set(additions.map(part => part.category)).size).toBe(6);
  for (const manifest of PART_PACKAGES.filter(pkg => pkg.compression)) {
    const payload = validatePayload(JSON.parse(new TextDecoder().decode(gunzipSync(
      readFileSync(resolve("public", manifest.url)),
    ))), manifest);
    for (const part of payload.parts) {
      const file = payload.files.find(file => file.path === part.file)!;
      expect(file.content).toMatch(/^0 !LDRAW_ORG (Unofficial_)?Part(?: UPDATE[^\r\n]*)?\r?$/m);
      expect(part.name).not.toMatch(/^[~=]|Pattern|Sticker|Flexible/i);
    }
  }
  // One import validates all selected roots while compiling only requested geometry.
  const text = parts.map(part => `1 7 0 0 0 1 0 0 0 1 0 0 0 1 ${part.ldrawId}.dat`).join("\n");
  const bytes = new TextEncoder().encode(text);
  const document = await importLDraw(bytes, "defaults.ldr", "ldr", bytes, { online: false });
  expect(document.imported!.instances.filter(instance => instance.part.status !== "resolved")).toEqual([]);
  for (const part of parts) {
    const surfaces = compilePart(document.imported!, `${part.ldrawId}.dat`, "7");
    expect(surfaces.some(surface => surface.positions.length > 0), part.ldrawId).toBe(true);
    expect(surfaces.every(surface => surface.positions.every(Number.isFinite)), part.ldrawId).toBe(true);
  }
  expect(fetcher).toHaveBeenCalledTimes(PART_PACKAGES.length);
  let placed = createEmptyDocument("Offline building");
  for (const category of new Set(additions.map(part => part.category))) {
    const part = additions.find(part => part.category === category)!;
    expect(await searchLocalParts(part.ldrawId, category)).toContainEqual(part);
    const prepared = await prepareLibraryPart(part);
    placed = placePreparedPart(placed, prepared, { x: 0, y: 0, z: 0 }, "#B40000", "4");
  }
  await saveProject(placed);
  builderDatabase.close();
  await builderDatabase.open();
  fetcher.mockClear();
  await ensureBundledPackages();
  expect(await loadCurrentProject()).toMatchObject({ id: placed.id, imported: { instances: placed.imported!.instances } });
  expect(await searchLocalParts()).toHaveLength(369);
  expect(fetcher).not.toHaveBeenCalled();
}, 120_000);

it("upgrades without deleting projects or separate packages and retries a failed bundled installation", async () => {
  const fetcher = assets();
  const project = createEmptyDocument("Keep my work");
  await saveProject(project);
  await installPackage("ldraw-bricks");
  const old = await builderDatabase.partPackages.get("ldraw-bricks");
  await builderDatabase.partPackages.put({ ...old!, id: "independent-package", version: "2099-01-01" });
  const oldSource = await builderDatabase.libraryFiles.get("ldraw-bricks:parts/3001.dat");
  fetcher.mockImplementationOnce(async () => new Response("broken"));
  await expect(ensureBundledPackages()).rejects.toThrow("Unvollständiger");
  expect(await loadCurrentProject()).toMatchObject({ id: project.id });
  await ensureBundledPackages();
  expect(await builderDatabase.partPackages.get("independent-package")).toBeDefined();
  expect(await builderDatabase.libraryFiles.get("ldraw-bricks:parts/3001.dat")).toEqual(oldSource);
  expect(await builderDatabase.partPackages.get("ldraw-bricks")).toEqual(old);
  expect(await searchLocalParts()).toHaveLength(369);
}, 60_000);

it("rolls back a failed default-package write and leaves the previous project intact", async () => {
  assets();
  const project = createEmptyDocument("Quota protection");
  await saveProject(project);
  const manifest = PART_PACKAGES.find(pkg => pkg.compression)!;
  vi.spyOn(builderDatabase.libraryFiles, "bulkPut").mockRejectedValueOnce(new Error("QuotaExceededError"));
  await expect(installPackage(manifest.id)).rejects.toThrow("QuotaExceededError");
  expect(await builderDatabase.libraryParts.count()).toBe(0);
  expect(await builderDatabase.partPackages.count()).toBe(0);
  expect(await loadCurrentProject()).toMatchObject({ id: project.id });
});

it("upgrades the previous 312-part distribution without replacing saved projects", async () => {
  assets();
  for (const manifest of PART_PACKAGES.filter(pkg => pkg.bundled)) {
    if (manifest.compression !== "gzip") {
      await installPackage(manifest.id);
      continue;
    }
    const previousUrl = manifest.url.replace("2026-11-17", "2026-11-16");
    const previous = JSON.parse(new TextDecoder().decode(gunzipSync(readFileSync(resolve("public", previousUrl)))));
    await builderDatabase.libraryParts.bulkPut(previous.parts);
    await builderDatabase.libraryFiles.bulkPut(previous.files.map((file: { path: string }) => ({
      ...file, id: `${manifest.id}:${file.path}`, packageId: manifest.id,
    })));
    await builderDatabase.partPackages.put({ ...manifest, version: previous.version, installedAt: "2026-11-16" });
  }
  expect(await searchLocalParts()).toHaveLength(312);
  const project = createEmptyDocument("Preserved during offline library upgrade");
  await saveProject(project);
  await ensureBundledPackages();
  expect(await searchLocalParts()).toHaveLength(369);
  expect(await loadCurrentProject()).toMatchObject({ id: project.id, name: project.name });
  for (const manifest of PART_PACKAGES.filter(pkg => pkg.compression === "gzip")) {
    expect(await builderDatabase.partPackages.get(manifest.id)).toMatchObject({
      version: "2026-11-17", sha256: manifest.sha256,
    });
  }
}, 60_000);
