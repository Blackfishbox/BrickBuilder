/**
 * Deliberate snapshot maintenance, never a build hook.
 * Run from scripts/: pnpm exec tsx ./review-unofficial-parts.ts
 *   <unofficial.zip> <approved-official-directory> [--write]
 *
 * The archive and expanded source inputs stay outside Git. Admission is based
 * on original per-file headers, complete dependencies and actual compilation.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { gzipSync, gunzipSync } from "node:zlib";
import { unzipSync } from "../artifacts/brickbuilder-mobile/node_modules/fflate/lib/node.cjs";
import { inspectFile, dependencies, candidates, OFFICIAL, UNOFFICIAL } from "../lib/ldraw-source/src/index";
import { compilePart, invalidateGeometry } from "../artifacts/brickbuilder-mobile/src/features/engine/ldraw-geometry";
import type { ImportedModel } from "../artifacts/brickbuilder-mobile/src/features/formats/types";

const [archivePath, officialDirectory, mode] = process.argv.slice(2);
if (!archivePath || !officialDirectory) throw new Error("Provide the unofficial ZIP and approved official directory.");
const root = resolve(import.meta.dirname, "..");
const app = resolve(root, "artifacts/brickbuilder-mobile");
const manifestPath = resolve(app, "src/features/formats/geometry-manifest.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const output = resolve(app, "public", manifest.url);
const baseline = process.env.LDRAW_REVIEW_BASELINE ?? output;
const baselineBytes = readFileSync(baseline);
const snapshot = JSON.parse(gunzipSync(baselineBytes).toString());
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const officialManifest = JSON.parse(readFileSync(resolve(officialDirectory, "manifest.json"), "utf8"));
const archive = readFileSync(archivePath);
if (archive.length > 160 * 1024 * 1024) throw new Error("Archive download budget exceeded.");
let expandedBytes = 0;
const archivePaths = new Set<string>();
const oversizedArchiveFiles: string[] = [];
const entries = unzipSync(archive, { filter: entry => {
  if (!/^(parts|p)\/[a-z0-9_/-]+\.dat$/i.test(entry.name) &&
      !/^CA(?:readme|license4)\.txt$/.test(entry.name)) return false;
  const normalized = entry.name.toLowerCase();
  if (archivePaths.has(normalized)) throw new Error(`Duplicate archive path: ${entry.name}`);
  archivePaths.add(normalized);
  if (entry.originalSize > 2 * 1024 * 1024) { oversizedArchiveFiles.push(entry.name); return false; }
  expandedBytes += entry.originalSize;
  if (expandedBytes > 300 * 1024 * 1024 || archivePaths.size > 15000) throw new Error("Archive expansion budget exceeded.");
  return true;
} });
if (Object.keys(entries).length > 15000 || Object.values(entries).reduce((sum, bytes) => sum + bytes.length, 0) > 300 * 1024 * 1024)
  throw new Error("Archive expansion budget exceeded.");
const original = new Map<string, any>(snapshot.files.map((file: any) => [file.path, file]));
const sources = new Map<string, any>();
const rejectedFiles = new Map<string, string>();
const checkedOfficial = new Set<string>();
function inspect(path: string, bytes: Uint8Array, origin: typeof OFFICIAL | typeof UNOFFICIAL) {
  const file = inspectFile(path, bytes, origin);
  // Texture images/data are not yet rendered. Do not admit incomplete decals.
  if (/^\s*0\s+!(?:TEXMAP|DATA)\b/m.test(file.content)) throw new Error("Texture-dependent geometry is not supported.");
  return { ...file, sha256: hash(bytes), byteLength: bytes.length };
}
for (const [name, bytes] of Object.entries(entries)) {
  if (!/\.dat$/i.test(name)) continue;
  const path = name.toLowerCase();
  if (sources.has(path) || rejectedFiles.has(path)) throw new Error(`Duplicate archive path: ${path}`);
  try { sources.set(path, inspect(path, bytes, UNOFFICIAL)); }
  catch (error) { rejectedFiles.set(path, String(error)); }
}
// Existing reviewed resources take precedence over a mutable tracker version.
for (const [path, file] of original) sources.set(path, file);
function source(path: string) {
  if (original.has(path)) return original.get(path);
  // Never silently replace a valid official file with a tracker revision.
  if (!checkedOfficial.has(path)) {
    checkedOfficial.add(path);
    try {
      const bytes = readFileSync(resolve(officialDirectory, path));
      if (hash(bytes) !== officialManifest.files[path]) throw new Error("Approved official file hash changed.");
      const file = inspect(path, bytes, OFFICIAL);
      sources.set(path, file);
    } catch { /* A validated tracker source may fill an official-library gap. */ }
  }
  return sources.get(path);
}
function closure(path: string, chain: string[] = [], result = new Set<string>()): Set<string> {
  if (chain.includes(path) || chain.length > 48) throw new Error("Cyclic or excessively deep geometry.");
  if (result.has(path)) return result;
  const file = source(path);
  if (!file) throw new Error(`Missing or rejected source: ${path}`);
  if (result.size >= 3000) throw new Error("Dependency budget exceeded.");
  result.add(path);
  for (const ref of dependencies(file.content)) {
    const child = candidates(ref).find(candidate => source(candidate));
    if (!child) throw new Error(`Missing or rejected dependency: ${ref}`);
    closure(child, [...chain, path], result);
  }
  return result;
}
const roots = Object.keys(entries).map(path => path.toLowerCase())
  .filter(path => /^parts\/[^/]+\.dat$/.test(path)).sort();
const failures: Record<string, string> = {};
const alreadyOfficial: string[] = [];
const admitted: { path: string; files: Set<string>; triangles: number; name: string }[] = [];
const triangleCounts = new Map<string, number>();
function triangleCount(path: string): number {
  if (triangleCounts.has(path)) return triangleCounts.get(path)!;
  let total = 0;
  for (const line of sources.get(path).content.split(/\r?\n/)) {
    const type = line.trim().split(/\s+/, 1)[0];
    if (type === "3") total++;
    else if (type === "4") total += 2;
    else if (type === "1") {
      const ref = dependencies(line)[0];
      const child = candidates(ref).find(candidate => sources.has(candidate))!;
      total += triangleCount(child);
    }
    if (total > 30000) break;
  }
  triangleCounts.set(path, total);
  return total;
}
for (const path of roots) {
  if (original.has(path)) continue;
  try {
    if (source(path)?.sourceUrl === `${OFFICIAL}${path}`) { alreadyOfficial.push(path); continue; }
    const files = closure(path);
    if (triangleCount(path) > 30000) throw new Error("Individual geometry exceeds the mobile baseline triangle budget.");
    const model = { resources: Object.fromEntries([...files].map(file => [file, sources.get(file)])) } as ImportedModel;
    const surfaces = compilePart(model, path, "16");
    const triangles = surfaces.reduce((sum, surface) => sum + surface.positions.length / 9, 0);
    if (!triangles || surfaces.some(surface => [...surface.positions].some(n => !Number.isFinite(n))))
      throw new Error("No finite renderable geometry.");
    invalidateGeometry(model);
    // Avoid an individual high-poly ornament dominating the mobile baseline.
    if (triangles > 30000) throw new Error("Individual geometry exceeds the mobile baseline triangle budget.");
    const name = sources.get(path).content.replace(/^\uFEFF/, "").split(/\r?\n/)[0].replace(/^0\s+/, "");
    admitted.push({ path, files, triangles, name });
  } catch (error) { failures[path] = String(error); }
  if ((admitted.length + Object.keys(failures).length) % 500 === 0)
    console.log(`Checked ${admitted.length + Object.keys(failures).length}/${roots.length} roots`);
}
// A bounded baseline prevents a full tracker dump being parsed on every import.
// Greedy incremental cost maximizes coverage using shared reviewed primitives.
const maxSourceBytes = 16 * 1024 * 1024;
const maxCompressedBytes = 3 * 1024 * 1024;
const selected = new Map(original);
let sourceBytes = [...selected.values()].reduce((sum, file) => sum + Buffer.byteLength(file.content), 0);
const additions: typeof admitted = [];
const remaining = [...admitted];
while (remaining.length) {
  const cost = (item: typeof admitted[number]) => [...item.files].reduce((sum, path) =>
    sum + (selected.has(path) ? 0 : sources.get(path).byteLength ?? Buffer.byteLength(sources.get(path).content)), 0);
  // Re-rank in small batches rather than a quadratic scan per admitted part.
  const costs = new Map(remaining.map(item => [item, cost(item)]));
  remaining.sort((a, b) => costs.get(a)! - costs.get(b)! || a.path.localeCompare(b.path, "en"));
  for (const next of remaining.splice(0, 128)) {
    const extra = cost(next);
    if (sourceBytes + extra > maxSourceBytes) continue;
    sourceBytes += extra;
    for (const path of next.files) selected.set(path, sources.get(path));
    additions.push(next);
  }
}
function build(items: typeof additions) {
  const paths = new Set(original.keys());
  for (const item of items) for (const path of item.files) paths.add(path);
  const legalDocuments = [...snapshot.legalDocuments];
  for (const name of ["CAreadme.txt", "CAlicense4.txt"]) {
    const content = new TextDecoder("utf-8", { fatal: true }).decode(entries[name]);
    if (!content.includes("Creative Commons")) throw new Error(`Missing unofficial legal document: ${name}`);
    const sourceUrl = `${UNOFFICIAL}${name}`;
    if (!legalDocuments.some((doc: any) => doc.sourceUrl === sourceUrl))
      legalDocuments.push({ name, sourceUrl, content });
  }
  if ([...paths].some(path => selected.get(path).license === "CC0-1.0") &&
      !legalDocuments.some((doc: any) => doc.name === "CC0-1.0.txt")) {
    const content = readFileSync(resolve(officialDirectory, "CC0-1.0.txt"), "utf8");
    if (!content.includes("Creative Commons")) throw new Error("Missing CC0 legal code.");
    legalDocuments.push({ name: "CC0-1.0.txt", sourceUrl: "https://creativecommons.org/publicdomain/zero/1.0/legalcode.txt", content });
  }
  return {
    ...snapshot,
    legalDocuments,
    files: [...paths].sort().map(path => selected.get(path)),
    parts: [...snapshot.parts, ...items.map(item => ({
      ldrawId: item.path.slice(6, -4), file: item.path, name: item.name,
    }))],
  };
}
let result = build(additions);
let bytes = gzipSync(JSON.stringify(result), { level: 9 });
if (bytes.length > maxCompressedBytes) {
  // Recompressing once per removed part makes large review runs needlessly slow.
  let low = 0, high = additions.length;
  while (low < high) {
    const count = Math.ceil((low + high) / 2);
    const candidate = build(additions.slice(0, count));
    const packed = gzipSync(JSON.stringify(candidate), { level: 9 });
    if (packed.length <= maxCompressedBytes) low = count;
    else high = count - 1;
  }
  additions.splice(low);
  result = build(additions);
  bytes = gzipSync(JSON.stringify(result), { level: 9 });
}
if (bytes.length > maxCompressedBytes) throw new Error("Existing baseline exceeds the compressed budget.");
const review = {
  version: 1, source: "https://library.ldraw.org/library/unofficial/ldrawunf.zip",
  archiveSha256: hash(archive), archiveBytes: archive.length,
  officialArchive: officialManifest.sha256,
  baselineSha256: hash(baselineBytes),
  inspectedRoots: roots.length, compatibleRoots: admitted.length,
  alreadyOfficial,
  oversizedArchiveFiles,
  addedParts: additions.length, totalParts: result.parts.length, totalFiles: result.files.length,
  limits: { maxSourceBytes, maxCompressedBytes, maxTrianglesPerPart: 30000 },
  added: additions.map(item => ({ file: item.path, name: item.name, triangles: item.triangles })),
  deferred: admitted.filter(item => !additions.includes(item)).map(item => item.path),
  rejected: failures,
  files: result.files.filter((file: any) => !original.has(file.path)).map(({ content, ...metadata }: any) => metadata),
  bundle: { bytes: bytes.length, sha256: hash(bytes) },
};
mkdirSync(resolve(root, "generated-artifacts/unofficial-review"), { recursive: true });
writeFileSync(resolve(root, "generated-artifacts/unofficial-review/report.json"), JSON.stringify(review, null, 2) + "\n");
console.log(JSON.stringify({ ...review, alreadyOfficial: alreadyOfficial.length, added: undefined, deferred: review.deferred.length, rejected: Object.keys(failures).length, files: review.files.length }, null, 2));
if (mode === "--write") {
  writeFileSync(output, bytes);
  writeFileSync(manifestPath, JSON.stringify({ ...manifest, ...review.bundle, partCount: result.parts.length, fileCount: result.files.length }, null, 2) + "\n");
  writeFileSync(resolve(app, "src/features/formats/unofficial-review.json"), JSON.stringify(review, null, 2) + "\n");
}
