import { Box3, Matrix4, Vector3 } from "three";
import type { BuilderDocument, Position3 } from "./model";
import type { ImportedInstance, ImportedModel, Affine } from "../formats/types";
import type { LibraryPart } from "../parts/types";
import { COLORS, resolveColor } from "../formats/colors";
import { importLDraw } from "../formats/ldraw/import";
import { compilePart, worldMatrix } from "../engine/ldraw-geometry";
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
function affineFromWorldMatrix(matrix: Matrix4): Affine {
  const e = matrix.elements, scale = 20;
  const clean = (value: number) => Object.is(value, -0) ? 0 : value;
  return [
    clean(e[0] * scale), clean(e[4] * scale), clean(e[8] * scale), clean(e[12] * scale),
    clean(-e[1] * scale), clean(-e[5] * scale), clean(-e[9] * scale), clean(-e[13] * scale),
    clean(e[2] * scale), clean(e[6] * scale), clean(e[10] * scale), clean(e[14] * scale),
  ];
}
function yawMatrix(angle: number): Matrix4 {
  const radians = angle * Math.PI / 180;
  const cosine = Math.abs(Math.cos(radians)) < 1e-12 ? 0 : Math.cos(radians);
  const sine = Math.abs(Math.sin(radians)) < 1e-12 ? 0 : Math.sin(radians);
  return new Matrix4().set(cosine, 0, sine, 0, 0, 1, 0, 0, -sine, 0, cosine, 0, 0, 0, 0, 1);
}
export function setImportedRotation(document: BuilderDocument, id: string, rotationY: number): BuilderDocument {
  if (!Number.isFinite(rotationY) || !document.imported) return document;
  const angle = Math.max(0, Math.min(360, Math.round(rotationY)));
  return editImported(document, id, instance => {
    const base = instance.rotationBaseMatrix ?? instance.matrix;
    if (angle === 0) {
      const { rotationY: _angle, rotationBaseMatrix: _base, ...rest } = instance;
      return { ...rest, matrix: [...base] as Affine };
    }
    const world = worldMatrix(base);
    const origin = new Vector3().setFromMatrixPosition(world);
    world.premultiply(yawMatrix(angle));
    world.setPosition(origin);
    return {
      ...instance,
      matrix: affineFromWorldMatrix(world),
      rotationY: angle,
      rotationBaseMatrix: [...base] as Affine,
    };
  });
}
export function rotateImported(document: BuilderDocument, id: string): BuilderDocument {
  const current = document.imported?.instances.find(instance => instance.id === id);
  if (!current) return document;
  if (current.rotationY !== undefined) return setImportedRotation(document, id, (current.rotationY + 90) % 360);
  return editImported(document, id, instance => {
    const m = instance.matrix;
    const matrix: Affine = [m[8], m[9], m[10], m[3], m[4], m[5], m[6], m[7], -m[0], -m[1], -m[2], m[11]];
    return { ...instance, matrix };
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
    if (!instance.rotationBaseMatrix) return { ...instance, matrix };
    const rotationBaseMatrix = [...instance.rotationBaseMatrix] as Affine;
    rotationBaseMatrix[3] += matrix[3] - instance.matrix[3];
    rotationBaseMatrix[7] += matrix[7] - instance.matrix[7];
    rotationBaseMatrix[11] += matrix[11] - instance.matrix[11];
    return { ...instance, matrix, rotationBaseMatrix };
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
