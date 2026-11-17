import { candidates, dependencies, inspectFile, OFFICIAL, UNOFFICIAL } from "@workspace/ldraw-source";
import { builderDatabase } from "@/storage/database";
import { IDENTITY } from "../../formats/ldraw/parser";
import type { ImportedModel } from "../../formats/types";
import type { LibraryFile, LibraryPart } from "../types";
import { prepareGeometry } from "../../engine/prepare-geometry";
import { compilePart } from "../../engine/ldraw-geometry";
import { getLocalPartFiles } from "../library";
import { hashBytes } from "../../formats/online-geometry";
import { SNAPSHOT_PACKAGE_PREFIX, snapshotRevision } from "./snapshot-source";

const models = new Map<string, { model: ImportedModel; bytes: number }>();
let modelBytes = 0;
let sourceCache: { key: string; files: Record<string, LibraryFile> } | undefined;
const MODEL_BUDGET = 8 * 1024 * 1024;

/** Read installed or previously acquired geometry only; never resolve online. */
export async function thumbnailModel(part: LibraryPart, revision: string, signal: AbortSignal): Promise<ImportedModel> {
  signal.throwIfAborted();
  const snapshotId = part.packageId.startsWith(SNAPSHOT_PACKAGE_PREFIX)
    ? part.packageId.slice(SNAPSHOT_PACKAGE_PREFIX.length) : undefined;
  const snapshot = snapshotId ? await builderDatabase.geometrySnapshots.get(snapshotId) : undefined;
  const installed = snapshotId ? undefined : await builderDatabase.partPackages.get(part.packageId);
  if (snapshotId ? !snapshot || snapshotRevision(snapshot) !== revision
    : !installed || `${installed.version}:${installed.sha256}` !== revision) {
    throw new Error("Teilepaket nicht mehr verfügbar. Bibliothek erneut öffnen.");
  }
  const key = `${part.id}:${revision}`;
  const cached = models.get(key);
  if (cached) {
    models.delete(key); models.set(key, cached);
    return cached.model;
  }
  const packageKey = `${part.packageId}:${revision}`;
  let files = sourceCache?.key === packageKey ? sourceCache.files : undefined;
  if (!files) {
    const local = snapshot ? snapshot.files : await getLocalPartFiles(part.packageId);
    signal.throwIfAborted();
    files = Object.fromEntries(local.map(file => [file.path, file]));
    const cost = local.reduce((sum, file) => sum + file.content.length * 2, 0);
    // At most one package stays resident, and oversized packages are not cached.
    sourceCache = cost <= 8 * 1024 * 1024 ? { key: packageKey, files } : undefined;
  }
  const resources: Record<string, LibraryFile> = Object.create(null);
  let sourceBytes = 0;
  async function collect(reference: string, stack: string[]): Promise<void> {
    signal.throwIfAborted();
    const path = candidates(reference).find(candidate => files![candidate]);
    if (!path) throw new Error(`Lokale Vorschaugeometrie fehlt: ${reference}`);
    if (stack.includes(path) || stack.length > 48) throw new Error("Geometriehierarchie ungültig.");
    if (resources[path]) return;
    const file = files![path];
    sourceBytes += file.content.length * 2;
    if (sourceBytes > 4 * 1024 * 1024 || Object.keys(resources).length >= 3000) {
      throw new Error("Teil zu aufwendig für eine mobile Vorschau.");
    }
    if (snapshot && file.sha256) {
      const bytes = new TextEncoder().encode(file.content);
      if (await hashBytes(bytes) !== file.sha256 || bytes.length !== file.byteLength) {
        throw new Error(`Beschädigte Vorschaugeometrie: ${path}`);
      }
      const inspected = inspectFile(path, bytes, file.sourceUrl === `${UNOFFICIAL}${path}` ? UNOFFICIAL : OFFICIAL);
      if (inspected.sourceUrl !== file.sourceUrl || inspected.license !== file.license || inspected.author !== file.author) {
        throw new Error(`Ungültige Geometrieherkunft: ${path}`);
      }
    }
    resources[path] = file;
    for (const child of dependencies(file.content)) await collect(child, [...stack, path]);
  }
  await collect(part.file, []);
  const model: ImportedModel = {
    version: 1, format: "ldr", sourceName: part.file, originalBytes: [], sourceText: "",
    root: part.file, sections: {}, resources, legalDocuments: [], issues: [],
    instances: [{
      id: "thumbnail", reference: part.file, colorCode: "16", matrix: [...IDENTITY],
      sourcePath: [], part: { ldrawId: part.ldrawId, status: "resolved" },
    }],
  };
  await prepareGeometry(model, { signal });
  signal.throwIfAborted();
  const surfaces = compilePart(model, part.file, "16");
  if (!surfaces.some(surface => surface.positions.length)) throw new Error("Keine darstellbaren Flächen.");
  const bytes = sourceBytes + surfaces.reduce((sum, surface) =>
    sum + surface.positions.byteLength + surface.normals.byteLength + surface.edges.byteLength, 0);
  if (bytes > MODEL_BUDGET) throw new Error("Teil zu aufwendig für eine mobile Vorschau.");
  models.set(key, { model, bytes }); modelBytes += bytes;
  while (modelBytes > MODEL_BUDGET || models.size > 12) {
    const oldest = models.keys().next().value!;
    modelBytes -= models.get(oldest)!.bytes; models.delete(oldest);
  }
  return model;
}
