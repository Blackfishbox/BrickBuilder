import { Box3, Euler, Matrix4, Vector3 } from "three";
import type { BuilderDocument, Position3 } from "./model";
import { normalizeTiltAngle } from "./brick-transform";
import { clampRotationAngle } from "./model";
import type { ImportedInstance, ImportedModel, Affine } from "../formats/types";
import type { LibraryPart } from "../parts/types";
import { COLORS, resolveColor } from "../formats/colors";
import { importLDraw } from "../formats/ldraw/import";
import { compilePart, worldMatrix } from "../engine/ldraw-geometry";
import { localPartBounds, stackingBounds } from "../engine/stacking";
import type { InventoryChoice } from "../inventory/types";
import { allocatedCounts, MAX_INVENTORY_SPREAD_UNITS, type InventorySpreadRequest, requireAvailable } from "../inventory/accounting";
import { getImportPartFailures } from "../formats/import-failures";
import { brickBounds } from "./brick-transform";

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
function importedYawMatrix(angle: number): Matrix4 {
  const radians = ((angle % 360) + 360) % 360 * Math.PI / 180;
  const clean = (value: number) => Math.abs(value) < 1e-12 ? 0 : Math.abs(value - 1) < 1e-12 ? 1 : Math.abs(value + 1) < 1e-12 ? -1 : value;
  const cosine = clean(Math.cos(radians)), sine = clean(Math.sin(radians));
  return new Matrix4().set(cosine, 0, sine, 0, 0, 1, 0, 0, -sine, 0, cosine, 0, 0, 0, 0, 1);
}
function applyImportedTransform(
  model: ImportedModel, reference: string, base: Affine, rotationY: number,
  tiltX: number, tiltZ: number, rotationPivot?: [number, number, number],
): Affine {
  if (rotationY === 0 && tiltX === 0 && tiltZ === 0) return [...base];
  const world = worldMatrix(base);
  if (rotationY !== 0) {
    const pivot = rotationPivot
      ? new Vector3(...rotationPivot).applyMatrix4(worldMatrix(base))
      : new Vector3().setFromMatrixPosition(world);
    world.premultiply(new Matrix4().makeTranslation(pivot.x, pivot.y, pivot.z)
      .multiply(importedYawMatrix(rotationY))
      .multiply(new Matrix4().makeTranslation(-pivot.x, -pivot.y, -pivot.z)));
  }
  if (tiltX !== 0 || tiltZ !== 0) {
    const center = localPartBounds(model, reference).getCenter(new Vector3()).applyMatrix4(world);
    const tilt = new Matrix4().makeRotationFromEuler(new Euler(tiltX * Math.PI / 180, 0, tiltZ * Math.PI / 180, "XYZ"));
    world.premultiply(new Matrix4().makeTranslation(center.x, center.y, center.z)
      .multiply(tilt)
      .multiply(new Matrix4().makeTranslation(-center.x, -center.y, -center.z)));
  }
  return affineFromWorldMatrix(world);
}
function applyImportedYaw(
  model: ImportedModel, reference: string, base: Affine, rotationY: number,
  rotationPivot?: [number, number, number],
): Affine {
  return applyImportedTransform(model, reference, base, rotationY, 0, 0, rotationPivot);
}
export function tiltImported(document: BuilderDocument, id: string, tiltX: number, tiltZ: number): BuilderDocument {
  if (![tiltX, tiltZ].every(Number.isFinite)) return document;
  const model = document.imported;
  if (!model) return document;
  const x = normalizeTiltAngle(tiltX), z = normalizeTiltAngle(tiltZ);
  return editImported(document, id, instance => {
    const base = instance.rotationBaseMatrix ?? instance.tiltBaseMatrix ?? instance.matrix;
    const rotationY = instance.rotationY ?? 0;
    if (x === 0 && z === 0 && rotationY === 0) {
      const { tiltBaseMatrix: _tiltBase, rotationBaseMatrix: _rotationBase, rotationY: _rotation, tiltX: _x, tiltZ: _z, ...rest } = instance;
      return { ...rest, matrix: [...base] as Affine };
    }
    let matrix: Affine;
    try { matrix = applyImportedTransform(model, instance.reference, base, rotationY, x, z, instance.rotationPivot); }
    catch {
      // A missing part can still be transformed around its declared LDraw origin.
      const world = worldMatrix(base);
      const origin = new Vector3().setFromMatrixPosition(world);
      if (rotationY) world.premultiply(importedYawMatrix(rotationY));
      if (x || z) world.premultiply(new Matrix4().makeRotationFromEuler(new Euler(x * Math.PI / 180, 0, z * Math.PI / 180, "XYZ")));
      world.setPosition(origin);
      matrix = affineFromWorldMatrix(world);
    }
    let tiltBaseMatrix = [...base] as Affine;
    if (rotationY !== 0) {
      try { tiltBaseMatrix = applyImportedYaw(model, instance.reference, base, rotationY, instance.rotationPivot); }
      catch {
        const world = worldMatrix(base);
        const origin = new Vector3().setFromMatrixPosition(world);
        world.premultiply(importedYawMatrix(rotationY));
        world.setPosition(origin);
        tiltBaseMatrix = affineFromWorldMatrix(world);
      }
    }
    return {
      ...instance, tiltX: x, tiltZ: z,
      ...(rotationY ? { rotationY, rotationBaseMatrix: [...base] as Affine } : {}),
      tiltBaseMatrix, matrix,
    };
  });
}
export function setImportedRotation(
  document: BuilderDocument, id: string, rotationY: number,
  requestedPivot?: [number, number, number] | null,
): BuilderDocument {
  if (!Number.isFinite(rotationY)) return document;
  const model = document.imported;
  if (!model) return document;
  const angle = clampRotationAngle(rotationY);
  return editImported(document, id, instance => {
    const base = instance.rotationBaseMatrix ?? instance.tiltBaseMatrix ?? instance.matrix;
    const pivot = requestedPivot === undefined ? instance.rotationPivot : requestedPivot ?? undefined;
    const tiltX = instance.tiltX ?? 0, tiltZ = instance.tiltZ ?? 0;
    if (!angle && !tiltX && !tiltZ) {
      const { rotationY: _rotation, rotationBaseMatrix: _rotationBase, rotationPivot: _pivot,
        tiltBaseMatrix: _tiltBase, tiltX: _x, tiltZ: _z, ...rest } = instance;
      return { ...rest, matrix: [...base] as Affine };
    }
    let matrix: Affine, tiltBaseMatrix = [...base] as Affine;
    try {
      matrix = applyImportedTransform(model, instance.reference, base, angle, tiltX, tiltZ, pivot);
      if (angle) tiltBaseMatrix = applyImportedYaw(model, instance.reference, base, angle, pivot);
    } catch {
      const world = worldMatrix(base);
      const origin = new Vector3().setFromMatrixPosition(world);
      const yawPivot = pivot ? new Vector3(...pivot).applyMatrix4(worldMatrix(base)) : origin;
      if (angle) world.premultiply(new Matrix4().makeTranslation(yawPivot.x, yawPivot.y, yawPivot.z)
        .multiply(importedYawMatrix(angle))
        .multiply(new Matrix4().makeTranslation(-yawPivot.x, -yawPivot.y, -yawPivot.z)));
      if (tiltX || tiltZ) world.premultiply(new Matrix4().makeRotationFromEuler(new Euler(tiltX * Math.PI / 180, 0, tiltZ * Math.PI / 180, "XYZ")));
      matrix = affineFromWorldMatrix(world);
      if (angle) {
        const yawWorld = worldMatrix(base);
        const yawPivot = pivot ? new Vector3(...pivot).applyMatrix4(yawWorld) : new Vector3().setFromMatrixPosition(yawWorld);
        yawWorld.premultiply(new Matrix4().makeTranslation(yawPivot.x, yawPivot.y, yawPivot.z)
          .multiply(importedYawMatrix(angle))
          .multiply(new Matrix4().makeTranslation(-yawPivot.x, -yawPivot.y, -yawPivot.z)));
        tiltBaseMatrix = affineFromWorldMatrix(yawWorld);
      }
    }
    const { rotationPivot: _previousPivot, ...withoutPreviousPivot } = instance;
    return {
      ...withoutPreviousPivot, matrix, rotationY: angle || undefined,
      ...(angle ? { rotationBaseMatrix: [...base] as Affine } : {}),
      ...(angle && pivot ? { rotationPivot: [...pivot] as [number, number, number] } : {}),
      ...(angle || tiltX || tiltZ ? { tiltBaseMatrix } : {}),
    };
  });
}
export function rotateImported(document: BuilderDocument, id: string): BuilderDocument {
  const current = document.imported?.instances.find(instance => instance.id === id);
  return current ? setImportedRotation(document, id, ((current.rotationY ?? 0) + 90) % 360) : document;
}
export function rotateSelection(
  document: BuilderDocument,
  ids: Iterable<string>,
  primaryId: string,
  targetAngle: number,
  importedFloor = 0,
  rotationPivot?: [number, number, number] | null,
): BuilderDocument {
  if (!Number.isFinite(targetAngle) || !Number.isFinite(importedFloor)) return document;
  const requested = new Set(ids);
  requested.add(primaryId);
  const members = [
    ...document.bricks.filter(brick => requested.has(brick.id)).map(brick => ({
      id: brick.id, x: brick.x, z: brick.z, angle: brick.rotation, kind: "brick" as const,
    })),
    ...(document.imported?.instances ?? []).filter(instance => requested.has(instance.id)).map(instance => ({
      id: instance.id, x: instance.matrix[3] / 20, z: instance.matrix[11] / 20,
      angle: instance.rotationY ?? 0, kind: "imported" as const,
    })),
  ];
  const primary = members.find(member => member.id === primaryId);
  if (!primary || members.length === 0) return document;

  const angle = clampRotationAngle(Math.round(targetAngle));
  const delta = angle - primary.angle;
  if (Math.abs(delta) < 1e-9) return document;
  const pivot = {
    x: members.reduce((sum, member) => sum + member.x, 0) / members.length,
    z: members.reduce((sum, member) => sum + member.z, 0) / members.length,
  };
  const radians = delta * Math.PI / 180, cosine = Math.cos(radians), sine = Math.sin(radians);
  const wrapAngle = (value: number) => ((value % 360) + 360) % 360;
  const rotatedPosition = (x: number, z: number) => ({
    x: pivot.x + cosine * (x - pivot.x) + sine * (z - pivot.z),
    z: pivot.z - sine * (x - pivot.x) + cosine * (z - pivot.z),
  });
  const nextAngles = new Map(members.map(member => [
    member.id, member.id === primaryId ? angle : wrapAngle(member.angle + delta),
  ]));

  let next: BuilderDocument = document;
  for (const member of members) {
    const position = rotatedPosition(member.x, member.z);
    if (member.kind === "brick") {
      const selectedAngle = nextAngles.get(member.id)!;
      next = {
        ...next,
        bricks: next.bricks.map(brick => brick.id === member.id
          ? { ...brick, x: position.x, z: position.z, rotation: selectedAngle }
          : brick),
      };
    } else {
      const selectedAngle = nextAngles.get(member.id)!;
      next = setImportedRotation(next, member.id, selectedAngle,
        members.length === 1 && member.id === primaryId ? rotationPivot : undefined);
      const instance = next.imported?.instances.find(value => value.id === member.id);
      if (instance && !(members.length === 1 && member.id === primaryId && instance.rotationPivot)) next = moveImported(next, member.id, {
        x: position.x, y: -instance.matrix[7] / 20, z: position.z,
      });
    }
  }

  // Lift the group by one shared amount so grounding cannot change its internal spacing.
  let lift = 0;
  for (const member of members) {
    const brick = next.bricks.find(value => value.id === member.id);
    if (brick) {
      lift = Math.max(lift, -brickBounds(brick).min.y);
      continue;
    }
    const instance = next.imported?.instances.find(value => value.id === member.id);
    if (!instance || !next.imported) continue;
    try {
      const bounds = localPartBounds(next.imported, instance.reference)
        .clone().applyMatrix4(worldMatrix(instance.matrix));
      if (!bounds.isEmpty()) lift = Math.max(lift, importedFloor - bounds.min.y);
    } catch {
      // Unresolved imported geometry has no measurable bounds; its transform is still preserved.
    }
  }
  lift = Math.max(0, lift);
  if (lift > 1e-9) {
    for (const member of members) {
      const brick = next.bricks.find(value => value.id === member.id);
      if (brick) {
        next = { ...next, bricks: next.bricks.map(value => value.id === member.id
          ? { ...value, y: value.y + lift } : value) };
      } else {
        const instance = next.imported?.instances.find(value => value.id === member.id);
        if (instance) next = moveImported(next, member.id, {
          x: instance.matrix[3] / 20, y: -instance.matrix[7] / 20 + lift, z: instance.matrix[11] / 20,
        });
      }
    }
  }
  return next === document ? document : { ...next, updatedAt: new Date().toISOString() };
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
    const delta = [matrix[3] - instance.matrix[3], matrix[7] - instance.matrix[7], matrix[11] - instance.matrix[11]];
    const translateBase = (source: Affine) => {
      const updated = [...source] as Affine;
      updated[3] += delta[0]; updated[7] += delta[1]; updated[11] += delta[2];
      return updated;
    };
    return {
      ...instance, matrix,
      ...(instance.tiltBaseMatrix ? { tiltBaseMatrix: translateBase(instance.tiltBaseMatrix) } : {}),
      ...(instance.rotationBaseMatrix ? { rotationBaseMatrix: translateBase(instance.rotationBaseMatrix) } : {}),
    };
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

/** Prepare and append a complete, preflighted inventory batch as one document change. */
export function placeInventoryBatch(
  document: BuilderDocument,
  requests: InventorySpreadRequest[],
  preparedByPart: ReadonlyMap<string, PreparedPart>,
): BuilderDocument {
  if (!requests.length) return document;
  const requestedUnits = requests.reduce((sum, request) => sum + request.quantity, 0);
  if (requestedUnits > MAX_INVENTORY_SPREAD_UNITS) {
    throw new Error(`Pro Durchgang können höchstens ${MAX_INVENTORY_SPREAD_UNITS} Teile verteilt werden.`);
  }
  const inventory = document.inventory;
  if (!inventory) throw new Error("Keine Teileliste mehr vorhanden.");
  const rows = new Map(inventory.rows.map(row => [row.id, row]));
  const counts = allocatedCounts(document);
  for (const { choice, quantity } of requests) {
    const row = rows.get(choice.rowId);
    if (choice.listId !== inventory.id || !row || row.itemType !== "P") throw new Error("Diese Teilelisten-Auswahl ist nicht mehr gültig.");
    if (!Number.isSafeInteger(quantity) || quantity < 1) throw new Error("Ungültige Stückzahl für die Sammelplatzierung.");
    const count = counts.get(row.id) ?? 0;
    if (count + quantity > row.quantity) throw new Error(`BrickLink ${row.partId}, Farbe ${row.colorId}: Bestand reicht für die Sammelplatzierung nicht mehr aus.`);
    counts.set(row.id, count + quantity);
    const prepared = preparedByPart.get(choice.ldrawId);
    if (!prepared || prepared.part.ldrawId !== choice.ldrawId || prepared.model.instances[0]?.part.status !== "resolved") {
      throw new Error(`LDraw ${choice.ldrawId}: Geometrie konnte nicht vollständig geladen werden.`);
    }
    if (!resolveColor(choice.colorCode)) throw new Error(`LDraw-Farbe ${choice.colorCode} nicht verfügbar.`);
  }

  const units = requests.flatMap(request => Array.from({ length: request.quantity }, () => request));
  const localBounds = units.map(({ choice }) => {
    const prepared = preparedByPart.get(choice.ldrawId)!;
    return localPartBounds(prepared.model, prepared.model.instances[0].reference)
      .clone().applyMatrix4(worldMatrix([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0]));
  });
  const sceneBounds = new Box3();
  if (document.imported) {
    const importedBounds = stackingBounds(document.imported);
    if (document.imported.instances.some(instance => !importedBounds.has(instance.id))) {
      throw new Error("Die vorhandene Modellgeometrie ist nicht vollständig verfügbar. Bitte lade die fehlenden Teile, bevor du die Liste verteilst.");
    }
    for (const bounds of importedBounds.values()) sceneBounds.union(bounds);
  }
  for (const brick of document.bricks) sceneBounds.union(brickBounds(brick));
  const originX = sceneBounds.isEmpty() ? 1 : sceneBounds.max.x + 1;
  const originZ = sceneBounds.isEmpty() ? 0 : sceneBounds.min.z;
  const cellWidth = Math.max(0.25, ...localBounds.map(bounds => bounds.max.x - bounds.min.x)) + 0.75;
  const cellDepth = Math.max(0.25, ...localBounds.map(bounds => bounds.max.z - bounds.min.z)) + 0.75;
  const columns = Math.max(1, Math.ceil(Math.sqrt(units.length)));
  const placements = localBounds.map((bounds, index) => ({
    x: originX + (index % columns) * cellWidth - bounds.min.x,
    z: originZ + Math.floor(index / columns) * cellDepth - bounds.min.z,
  }));

  const original = document.imported;
  const resources = { ...(original?.resources ?? {}) };
  const legalDocuments = [...(original?.legalDocuments ?? [])];
  const instances = [...(original?.instances ?? [])];
  for (const prepared of new Set([...preparedByPart.values()])) {
    for (const [path, file] of Object.entries(prepared.model.resources)) {
      if (resources[path] && resources[path].content !== file.content) {
        throw new Error(`LDraw-Quellkonflikt: ${path}. Bestehende Geometrie bleibt unverändert.`);
      }
      resources[path] ??= file;
    }
    for (const legal of prepared.model.legalDocuments) {
      if (!legalDocuments.some(existing => JSON.stringify(existing) === JSON.stringify(legal))) legalDocuments.push(legal);
    }
  }
  units.forEach(({ choice }, index) => {
    const prepared = preparedByPart.get(choice.ldrawId)!;
    const source = prepared.model.instances[0];
    const colorCode = choice.colorCode;
    instances.push({
      ...source,
      id: `ldraw:${crypto.randomUUID()}`,
      colorCode,
      color: resolveColor(colorCode),
      matrix: [1, 0, 0, Math.round(placements[index].x * 2) / 2 * 20,
        0, 1, 0, prepared.bottom * 20, 0, 0, 1, Math.round(placements[index].z * 2) / 2 * 20],
      sourcePath: ["BrickBuilder"],
      sourceOccurrence: undefined,
      allocation: { listId: choice.listId, rowId: choice.rowId },
    });
  });
  return {
    ...document,
    updatedAt: new Date().toISOString(),
    imported: {
      ...(original ?? preparedByPart.values().next().value!.model),
      edited: true, resources, legalDocuments, instances,
    },
  };
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
