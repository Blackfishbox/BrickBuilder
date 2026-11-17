import { candidates } from "@workspace/ldraw-source";
import { builderDatabase } from "@/storage/database";
import type { RetrievalSnapshot } from "../../formats/types";
import type { LibraryPart } from "../types";

export const SNAPSHOT_PACKAGE_PREFIX = "geometry-snapshot:";
export const snapshotRevision = (snapshot: RetrievalSnapshot) => `${snapshot.id}:${snapshot.createdAt}`;

/** Retrieval snapshots already contain the complete acquired dependency closure. */
export async function cachedThumbnailSource(ldrawId: string) {
  const paths = candidates(`${ldrawId.replace(/\.dat$/i, "")}.dat`);
  // Cursor traversal avoids retaining every downloaded model in every row.
  const snapshot = await builderDatabase.geometrySnapshots.orderBy("createdAt").reverse()
    .filter(entry => entry.files.some(file => paths.includes(file.path))).first();
  const file = snapshot && paths.find(path => snapshot.files.some(file => file.path === path));
  if (!snapshot || !file) return undefined;
  const part: LibraryPart = {
    id: `thumbnail:${snapshot.id}:${ldrawId}`, packageId: `${SNAPSHOT_PACKAGE_PREFIX}${snapshot.id}`,
    ldrawId, file, name: `LDraw ${ldrawId}`, category: "", keywords: [],
  };
  return { part, revision: snapshotRevision(snapshot) };
}
