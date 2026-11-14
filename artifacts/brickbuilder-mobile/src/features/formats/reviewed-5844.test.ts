import { readFileSync } from "node:fs";
import { gunzipSync } from "fflate";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { inspectFile, OFFICIAL, UNOFFICIAL } from "@workspace/ldraw-source";
import { builderDatabase } from "@/storage/database";
import { compilePart } from "../engine/ldraw-geometry";
import { importLDraw } from "./ldraw/import";
import { importIO } from "./io/import";
import manifest from "./geometry-manifest.json";

const bundle = new Uint8Array(readFileSync(new URL(`../../../public/${manifest.url}`, import.meta.url)));
const snapshot = JSON.parse(new TextDecoder().decode(gunzipSync(bundle)));
beforeEach(async () => {
  await builderDatabase.open();
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (!String(url).includes(manifest.url)) throw new Error("No live geometry requests allowed");
    return new Response(bundle);
  }));
});
afterEach(async () => { vi.unstubAllGlobals(); vi.restoreAllMocks(); await builderDatabase.delete(); });

it("retains the actual unofficial source, author, license and complete renderable closure", async () => {
  const source = snapshot.files.find((file: { path: string }) => file.path === "parts/5844.dat");
  const inspected = inspectFile(source.path, new TextEncoder().encode(source.content), UNOFFICIAL);
  expect(inspected.sourceUrl).toBe(`${UNOFFICIAL}parts/5844.dat`);
  expect(inspected.author).toBe("Rene Rechthaler [Blechtaler]");
  expect(inspected.license).toBe("CC-BY-4.0");
  expect(() => inspectFile(source.path, new TextEncoder().encode(source.content), "https://example.invalid/" as typeof OFFICIAL)).toThrow();
  const doc = await importLDraw(new TextEncoder().encode("1 15 0 0 0 1 0 0 0 1 0 0 0 1 5844.dat"), "synthetic.ldr", "ldr", undefined, { online: false });
  expect(doc.imported!.instances[0].part.status).toBe("resolved");
  expect(compilePart(doc.imported!, "5844.dat", "15").some(surface => surface.positions.length > 0)).toBe(true);
  expect(Object.keys(doc.imported!.resources)).toHaveLength(19);
  expect(doc.imported!.legalDocuments.some(document => document.name === "CAlicense4.txt")).toBe(true);
});

it("reuses the credited reviewed closure offline without losing unofficial provenance", async () => {
  const bytes = new TextEncoder().encode("1 4 0 0 0 1 0 0 0 1 0 0 0 1 5844.dat");
  await importLDraw(bytes, "synthetic.ldr");
  const offline = vi.fn().mockRejectedValue(new Error("Offline"));
  vi.stubGlobal("fetch", offline);
  const restored = await importLDraw(bytes, "synthetic.ldr", "ldr", undefined, { online: false });
  expect(restored.imported!.instances[0].part.status).toBe("resolved");
  expect(restored.imported!.resources["parts/5844.dat"].sourceUrl).toBe(`${UNOFFICIAL}parts/5844.dat`);
  expect(restored.imported!.issues.some(issue => issue.code === "geometry-cache")).toBe(false);
  expect(offline).not.toHaveBeenCalled();
});

it.skipIf(!process.env.BRICKBUILDER_IO_REFERENCE)("resolves all 20 occurrences in the optional private Studio reference", async () => {
  const bytes = new Uint8Array(readFileSync(process.env.BRICKBUILDER_IO_REFERENCE!));
  const doc = await importIO(bytes, "private-reference.io", { online: false });
  const instances = doc.imported!.instances.filter(instance => instance.reference === "5844.dat");
  expect(instances).toHaveLength(20);
  expect(instances.every(instance => instance.part.status === "resolved")).toBe(true);
  expect(doc.imported!.issues.some(issue => issue.code === "missing-part" && issue.reference === "5844.dat")).toBe(false);
  expect(new Uint8Array(doc.imported!.originalBytes)).toEqual(bytes);
}, 60000);
