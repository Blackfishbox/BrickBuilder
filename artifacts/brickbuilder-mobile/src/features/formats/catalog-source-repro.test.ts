import { readFile } from "node:fs/promises";
import { afterEach, expect, it, vi } from "vitest";
import { builderDatabase } from "@/storage/database";
import { prepareLibraryPart } from "../editor/ldraw-editing";
import { acquireThumbnailGeometry } from "../parts/thumbnails/acquire";
import manifest from "./geometry-manifest.json";

// Optional integration against the operator's pinned archive API, never a live LDraw crawl.
const api = process.env.BRICKBUILDER_REPRO_API;
afterEach(async () => { vi.unstubAllGlobals(); await builderDatabase.delete(); });
it.skipIf(!api)("previews and prepares the real 3942a source and its full closure", async () => {
  const network = globalThis.fetch;
  const bundled = new Uint8Array(await readFile(new URL(`../../../public/${manifest.url}`, import.meta.url)));
  vi.stubGlobal("fetch", async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes(manifest.url)) return new Response(bundled);
    const path = new URL(url, "https://test.invalid").searchParams.get("path")!;
    return network(`${api}/ldraw/file?path=${encodeURIComponent(path)}`);
  });
  await builderDatabase.open();
  await acquireThumbnailGeometry("3942a", new AbortController().signal);
  const prepared = await prepareLibraryPart({
    id: "catalog:3942a", packageId: "catalog", ldrawId: "3942a", file: "parts/3942a.dat",
    name: "Cone 2 x 2 x 2, Solid Stud", category: "", keywords: [],
  });
  expect(prepared.model.instances[0].part.status).toBe("resolved");
  expect(await builderDatabase.geometrySnapshots.count()).toBeGreaterThan(0);
}, 60_000);
