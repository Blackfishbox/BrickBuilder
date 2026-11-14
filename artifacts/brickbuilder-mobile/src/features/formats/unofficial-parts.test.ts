import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { gunzipSync } from "fflate";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { candidates, dependencies, inspectFile, OFFICIAL, UNOFFICIAL } from "@workspace/ldraw-source";
import { builderDatabase } from "@/storage/database";
import type { LibraryFile, PackagePayload } from "../parts/types";
import { importLDraw } from "./ldraw/import";
import manifest from "./geometry-manifest.json";
import review from "./unofficial-review.json";

const bundle = readFileSync(new URL(`../../../public/${manifest.url}`, import.meta.url));
const snapshot = JSON.parse(new TextDecoder().decode(gunzipSync(bundle))) as {
  files: LibraryFile[];
  parts: { ldrawId: string; file: string }[];
  legalDocuments: PackagePayload["legalDocuments"];
};
const files = new Map(snapshot.files.map(file => [file.path, file]));
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
beforeEach(async () => { await builderDatabase.open(); });
afterEach(async () => { vi.unstubAllGlobals(); await builderDatabase.delete(); });

it("ships a bounded, pinned selection with original per-file provenance and legal documents", () => {
  expect(review.addedParts).toBeGreaterThan(500);
  expect(review.bundle.sha256).toBe(manifest.sha256);
  expect(hash(bundle)).toBe(manifest.sha256);
  expect(bundle.length).toBeLessThanOrEqual(review.limits.maxCompressedBytes);
  expect(snapshot.parts).toHaveLength(review.totalParts);
  expect(snapshot.files).toHaveLength(review.totalFiles);
  expect(new Set(snapshot.parts.map(part => part.file)).size).toBe(snapshot.parts.length);
  for (const file of snapshot.files) {
    const origin = file.sourceUrl === `${UNOFFICIAL}${file.path}` ? UNOFFICIAL : OFFICIAL;
    const bytes = new TextEncoder().encode(file.content);
    const inspected = inspectFile(file.path, bytes, origin);
    expect(inspected.sourceUrl).toBe(file.sourceUrl);
    expect(inspected.author).toBe(file.author);
    expect(inspected.license).toBe(file.license);
    expect(file.content).not.toMatch(/^\s*0\s+!(?:TEXMAP|DATA)\b/m);
    if (file.sha256) expect(hash(bytes)).toBe(file.sha256);
  }
  for (const source of review.files) {
    expect(files.get(source.path)?.sha256).toBe(source.sha256);
    expect(files.get(source.path)?.sourceUrl).toBe(source.sourceUrl);
  }
  for (const name of ["CAreadme.txt", "CAlicense4.txt"]) {
    expect(snapshot.legalDocuments.some(doc => doc.name === name && doc.sourceUrl === `${UNOFFICIAL}${name}`)).toBe(true);
  }
  if (snapshot.files.some(file => file.license === "CC0-1.0"))
    expect(snapshot.legalDocuments.some(doc => doc.name === "CC0-1.0.txt")).toBe(true);
}, 30000);

it("retains complete acyclic dependencies for every shipped root", () => {
  const visited = new Set<string>();
  function visit(path: string, chain: string[]) {
    expect(chain).not.toContain(path);
    expect(chain.length).toBeLessThanOrEqual(48);
    if (visited.has(path)) return;
    const file = files.get(path);
    expect(file, path).toBeDefined();
    for (const ref of dependencies(file!.content)) {
      const child = candidates(ref).find(candidate => files.has(candidate));
      expect(child, `${path} -> ${ref}`).toBeDefined();
      visit(child!, [...chain, path]);
    }
    visited.add(path);
  }
  for (const part of snapshot.parts) visit(part.file, []);
  for (const part of review.added) {
    expect(files.get(part.file)?.sourceUrl).toBe(`${UNOFFICIAL}${part.file}`);
    expect(part.triangles).toBeGreaterThan(0);
    expect(part.triangles).toBeLessThanOrEqual(review.limits.maxTrianglesPerPart);
  }
}, 30000);

it("imports a spread of newly supported parts without external requests and reuses their cache offline", async () => {
  const chosen = [0, Math.floor(review.added.length / 3), Math.floor(review.added.length * 2 / 3), review.added.length - 1]
    .map(index => review.added[index].file.slice(6));
  const bytes = new TextEncoder().encode(chosen.map((ref, index) =>
    `1 4 ${index * 200} 0 0 1 0 0 0 1 0 0 0 1 ${ref}`).join("\n"));
  const fetcher = vi.fn(async (url: string) => {
    if (!String(url).includes(manifest.url)) throw new Error("No live tracker or model API access.");
    return new Response(bundle);
  });
  vi.stubGlobal("fetch", fetcher);
  const first = await importLDraw(bytes, "reviewed-unofficial.ldr", "ldr", undefined, { online: false });
  expect(first.imported!.instances.map(instance => instance.part.status)).toEqual(chosen.map(() => "resolved"));
  expect(first.imported!.issues.filter(issue => ["missing-part", "geometry-invalid", "geometry-cache"].includes(issue.code))).toEqual([]);
  const offline = vi.fn().mockRejectedValue(new Error("Offline"));
  vi.stubGlobal("fetch", offline);
  const restored = await importLDraw(bytes, "reviewed-unofficial.ldr", "ldr", undefined, { online: false });
  expect(restored.imported!.instances.every(instance => instance.part.status === "resolved")).toBe(true);
  expect(offline).not.toHaveBeenCalled();
  expect(restored.imported!.originalBytes).toEqual(Array.from(bytes));
}, 30000);
