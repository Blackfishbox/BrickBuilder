import { Box3, Euler, Matrix4, Vector3 } from "three";
import type { BuilderDocument, Position3 } from "./model";
import { normalizeTiltAngle } from "./brick-transform";
import type { ImportedInstance, ImportedModel, Affine } from "../formats/types";
import type { LibraryPart } from "../parts/types";
import { COLORS, resolveColor } from "../formats/colors";
import { importLDraw } from "../formats/ldraw/import";
import { compilePart, worldMatrix } from "../engine/ldraw-geometry";
import { localPartBounds } from "../engine/stacking";
import type { InventoryChoice } from "../inventory/types";
import { requireAvailable } from "../inventory/accounting";
import { getImportPartFailures } from "../formats/import-failures";

export interface PreparedPart {
  part: LibraryPart;
  model: ImportedModel;
  bottom: number;
}
export function appearanceCode(hex: string, code?: string): string {
  if (code && resolveColor(code)) return code;
  return COLORS.find(color => color.hex.toLowerCase() === hex.toLowerCase())?.ldrawCode ??
    `0x2${hex.replace("#", "").toUpperCase()}`;
}
export async function prepareLibraryPart(part: LibraryPart, signal?: AbortSignal): Promise<PreparedPart> {
  const reference = `${part.ldrawId.replace(/\.dat$/i, "")}.dat`;
  const bytes = new TextEncoder().encode(`0 LDraw placement\n1 7 0 0 0 1 0 0 0 1 0 0 0 1 ${reference}\n`);
  const document = await importLDraw(bytes, "placement.ldr", "ldr", bytes, { signal, online: true, retry: true });
  signal?.throwIfAborted();
  const model = document.imported!, instance = model.instances[0];
  if (!instance || instance.part.status !== "resolved") {
    const reasons = getImportPartFailures(model).flatMap(failure => failure.reasons);
    throw new Error(`LDraw ${part.ldrawId}: Geometrie konnte nicht geladen werden. ${
      reasons.join(" ") || "Keine vollständige Geometrie verfügbar."
    }`);
  }
  const bounds = new Box3(), point = new Vector3(), matrix = worldMatrix(instance.matrix);
  for (const surface of compilePart(model, reference, "16")) {
    for (let i = 0; i < surface.positions.length; i += 3) bounds.expandByPoint(point.fromArray(surface.positions, i).applyMatrix4(matrix));
  }
  if (bounds.isEmpty()) throw new Error(`LDraw ${part.ldrawId}: keine darstellbaren Flächen.`);
  return { part, model, bottom: bounds.min.y };
}

export function editImported(
  document: BuilderDocument, id: string,
  transform: (instance: ImportedInstance) => ImportedInstance | null,
): BuilderDocument {
  if (!document.imported?.instances.some(instance => instance.id === id)) return document;
  const instances = document.imported.instances.flatMap(instance => {
    if (instance.id !== id) return [instance];
    const next = transform(instance);
    return next ? [next] : [];
  });
  return { ...document, updatedAt: new Date().toISOString(), imported: { ...document.imported, edited: true, instances } };
}
export function recolorImported(document: BuilderDocument, id: string, hex: string, code?: string): BuilderDocument {
  const colorCode = appearanceCode(hex, code);
  return editImported(document, id, instance => ({ ...instance, colorCode, color: resolveColor(colorCode) }));
}
function rotateImportedBasisY(matrix: Affine): Affine {
  return [matrix[8], matrix[9], matrix[10], matrix[3], matrix[4], matrix[5], matrix[6], matrix[7], -matrix[0], -matrix[1], -matrix[2], matrix[11]];
}
function affineFromWorldMatrix(matrix: Matrix4): Affine {
  const e = matrix.elements, scale = 20;
  return [
    e[0] * scale, e[4] * scale, e[8] * scale, e[12] * scale,
    -e[1] * scale, -e[5] * scale, -e[9] * scale, -e[13] * scale,
    e[2] * scale, e[6] * scale, e[10] * scale, e[14] * scale,
  ];
}
function applyImportedTilt(model: ImportedModel, reference: string, base: Affine, tiltX: number, tiltZ: number): Affine {
  if (tiltX === 0 && tiltZ === 0) return [...base];
  const center = localPartBounds(model, reference).getCenter(new Vector3());
  const world = worldMatrix(base);
  const pivot = center.applyMatrix4(world);
  const rotation = new Matrix4().makeRotationFromEuler(new Euler(
    tiltX * Math.PI / 180, 0, tiltZ * Math.PI / 180, "XYZ",
  ));
  world.premultiply(new Matrix4().makeTranslation(pivot.x, pivot.y, pivot.z)
    .multiply(rotation)
    .multiply(new Matrix4().makeTranslation(-pivot.x, -pivot.y, -pivot.z)));
  return affineFromWorldMatrix(world);
}
export function tiltImported(document: BuilderDocument, id: string, tiltX: number, tiltZ: number): BuilderDocument {
  if (![tiltX, tiltZ].every(Number.isFinite)) return document;
  const model = document.imported;
  if (!model) return document;
  const x = normalizeTiltAngle(tiltX), z = normalizeTiltAngle(tiltZ);
  return editImported(document, id, instance => {
    const base = instance.tiltBaseMatrix ?? instance.matrix;
    if (x === 0 && z === 0) {
      const { tiltBaseMatrix: _base, tiltX: _x, tiltZ: _z, ...rest } = instance;
      return { ...rest, matrix: [...base] as Affine };
    }
    let matrix: Affine;
    try { matrix = applyImportedTilt(model, instance.reference, base, x, z); }
    catch {
      // A missing part can still be transformed around its declared LDraw origin.
      const world = worldMatrix(base);
      const rotation = new Matrix4().makeRotationFromEuler(new Euler(x * Math.PI / 180, 0, z * Math.PI / 180, "XYZ"));
      world.premultiply(rotation);
      matrix = affineFromWorldMatrix(world);
    }
    return { ...instance, tiltX: x, tiltZ: z, tiltBaseMatrix: [...base] as Affine, matrix };
  });
}
export function rotateImported(document: BuilderDocument, id: string): BuilderDocument {
  const model = document.imported;
  return editImported(document, id, instance => {
    const base = rotateImportedBasisY(instance.tiltBaseMatrix ?? instance.matrix);
    const tiltX = instance.tiltX ?? 0, tiltZ = instance.tiltZ ?? 0;
    if (!tiltX && !tiltZ) return { ...instance, matrix: base };
    let matrix = base;
    if (model) {
      try { matrix = applyImportedTilt(model, instance.reference, base, tiltX, tiltZ); }
      catch {
        const world = worldMatrix(base);
        world.premultiply(new Matrix4().makeRotationFromEuler(new Euler(tiltX * Math.PI / 180, 0, tiltZ * Math.PI / 180, "XYZ")));
        matrix = affineFromWorldMatrix(world);
      }
    }
    return { ...instance, matrix, tiltBaseMatrix: base };
  });
}
export function moveImported(document: BuilderDocument, id: string, position: Position3, snapXZ = true, transform?: Affine): BuilderDocument {
  return editImported(document, id, instance => {
    if (transform && (transform.length !== 12 || !transform.every(Number.isFinite))) throw new Error("Ungültige Verbindungstransformation.");
    const matrix = [...(transform ?? instance.matrix)] as Affine;
    // Do not divide and multiply the source LDU translation through UI units:
    // that changes exact off-grid coefficients by floating-point roundoff.
    if (!transform) {
      matrix[3] = (snapXZ ? Math.round(position.x * 2) / 2 : position.x) * 20;
      matrix[7] = -position.y * 20;
      matrix[11] = (snapXZ ? Math.round(position.z * 2) / 2 : position.z) * 20;
    }
    if (!instance.tiltBaseMatrix) return { ...instance, matrix };
    const tiltBaseMatrix = [...instance.tiltBaseMatrix] as Affine;
    tiltBaseMatrix[3] += matrix[3] - instance.matrix[3];
    tiltBaseMatrix[7] += matrix[7] - instance.matrix[7];
    tiltBaseMatrix[11] += matrix[11] - instance.matrix[11];
    return { ...instance, matrix, tiltBaseMatrix };
  });
}
export function placePreparedPart(document: BuilderDocument, prepared: PreparedPart, position: Position3, hex: string, code?: string): BuilderDocument {
  if (![position.x, position.y, position.z].every(Number.isFinite)) throw new Error("Ungültige Platzierungsposition.");
  const original = document.imported;
  const resources = { ...(original?.resources ?? {}) };
  for (const [path, file] of Object.entries(prepared.model.resources)) {
    if (resources[path] && resources[path].content !== file.content) throw new Error(`LDraw-Quellkonflikt: ${path}. Bestehende Geometrie bleibt unverändert.`);
    resources[path] = resources[path] ?? file;
  }
  const colorCode = appearanceCode(hex, code);
  const instance: ImportedInstance = {
    ...prepared.model.instances[0], id: `ldraw:${crypto.randomUUID()}`, colorCode, color: resolveColor(colorCode),
    matrix: [1, 0, 0, Math.round(position.x * 2) / 2 * 20, 0, 1, 0, -(position.y - prepared.bottom) * 20, 0, 0, 1, Math.round(position.z * 2) / 2 * 20],
    sourcePath: ["BrickBuilder"],
    sourceOccurrence: undefined,
  };
  const legalDocuments = [...(original?.legalDocuments ?? [])];
  for (const legal of prepared.model.legalDocuments) {
    if (!legalDocuments.some(existing => JSON.stringify(existing) === JSON.stringify(legal))) legalDocuments.push(legal);
  }
  return {
    ...document, updatedAt: new Date().toISOString(),
    imported: { ...(original ?? prepared.model), edited: true, resources, legalDocuments,
      instances: [...(original?.instances ?? []), instance] },
  };
}

/** Availability and allocation are committed together against the latest document. */
export function placeInventoryPart(document: BuilderDocument, prepared: PreparedPart, position: Position3, choice: InventoryChoice, appearance?: { hex: string; code?: string }): BuilderDocument {
  requireAvailable(document, choice);
  if (prepared.part.ldrawId !== choice.ldrawId) throw new Error("Teilelisten-Geometrie stimmt nicht mit der Auswahl überein.");
  const color = resolveColor(choice.colorCode);
  if (!color) throw new Error(`LDraw-Farbe ${choice.colorCode} nicht verfügbar. Teileliste erneut auswählen.`);
  // Appearance may change without returning the original physical unit to stock.
  const next = placePreparedPart(document, prepared, position, appearance?.hex ?? color.hex, appearance ? appearance.code : choice.colorCode);
  const instances = next.imported!.instances;
  return { ...next, imported: { ...next.imported!, instances: instances.map((instance, index) =>
    index === instances.length - 1 ? { ...instance, allocation: { listId: choice.listId, rowId: choice.rowId } } : instance) } };
}

/** Geometry acquisition must never replace edits or resurrect deleted instances. */
export function enrichImportedGeometry(current: ImportedModel, resolved: ImportedModel): ImportedModel {
  const known = new Map(resolved.instances.map(instance => [instance.id, instance]));
  const legalDocuments = [...current.legalDocuments];
  for (const legal of resolved.legalDocuments) {
    if (!legalDocuments.some(existing => JSON.stringify(existing) === JSON.stringify(legal))) legalDocuments.push(legal);
  }
  const snapshots = new Map([...(current.retrievalSnapshots ?? []), ...(resolved.retrievalSnapshots ?? [])].map(snapshot => [snapshot.id, snapshot]));
  return {
    ...current, resources: { ...resolved.resources, ...current.resources }, legalDocuments,
    retrievalSnapshots: [...snapshots.values()],
    issues: [...current.issues.filter(issue => !issue.code.startsWith("geometry-")), ...resolved.issues.filter(issue => issue.code.startsWith("geometry-"))],
    instances: current.instances.map(instance => {
      const source = known.get(instance.id);
      return source?.reference === instance.reference
        ? { ...instance, part: { ...instance.part, ...source.part } } : instance;
    }),
  };
}
