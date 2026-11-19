import type { BuilderDocument } from "../editor/model";
import { inventorySchema, allocationSchema, type Allocation, type Inventory, type InventoryChoice, type InventoryResolution } from "./types";

export const MAX_INVENTORY_SPREAD_UNITS = 1000;

/** Stock is always derived from effective instances, including undo/redo snapshots. */
export function allocatedCounts(document: BuilderDocument): Map<string, number> {
  const counts = new Map<string, number>();
  for (const instance of document.imported?.instances ?? []) {
    const allocation = instance.allocation;
    if (allocation && allocation.listId === document.inventory?.id) counts.set(allocation.rowId, (counts.get(allocation.rowId) ?? 0) + 1);
  }
  return counts;
}
export interface InventorySpreadRequest { choice: InventoryChoice; quantity: number }
export interface InventorySpreadPick { ldrawId?: string; colorCode?: string }
export interface InventorySpreadFailure {
  ldrawId: string;
  quantity: number;
  reason: string;
}
export interface InventorySpreadResult {
  placed: number;
  skipped: number;
  deferred: number;
  failures: InventorySpreadFailure[];
}
export interface InventorySpreadCandidate {
  rowId: string;
  partId: string;
  quantity: number;
  choice?: InventoryChoice;
  issue?: string;
}
/** Resolves only evidence-backed unique choices or explicit per-row user choices. */
export function inventorySpreadCandidates(
  document: BuilderDocument,
  resolutions: Record<string, InventoryResolution>,
  picks: Record<string, InventorySpreadPick>,
): InventorySpreadCandidate[] {
  const inventory = document.inventory;
  if (!inventory) return [];
  const counts = allocatedCounts(document);
  return inventory.rows.flatMap(row => {
    const quantity = Math.max(0, row.quantity - (counts.get(row.id) ?? 0));
    if (!quantity) return [];
    const resolution = resolutions[row.id];
    let issue: string | undefined;
    let choice: InventoryChoice | undefined;
    if (row.itemType !== "P") issue = `BL ${row.partId}: Positionstyp ${row.itemType} ist kein Einzelteil.`;
    else if (!resolution) issue = `BL ${row.partId}: Zuordnung wird noch geprüft.`;
    else if (!resolution.parts.length) issue = `BL ${row.partId}: kein belegtes LDraw-Teil.`;
    else if (!resolution.colors.length) issue = `BL ${row.partId}, Farbe ${row.colorId}: keine belegte LDraw-Farbe.`;
    else {
      const part = resolution.parts.length === 1
        ? resolution.parts[0]
        : resolution.parts.find(value => value.ldrawId === picks[row.id]?.ldrawId);
      const color = resolution.colors.length === 1
        ? resolution.colors[0]
        : resolution.colors.find(value => value.ldrawCode === picks[row.id]?.colorCode);
      if (!part) issue = `BL ${row.partId}: mehrdeutiges Teil braucht eine Auswahl.`;
      else if (!color) issue = `BL ${row.partId}, Farbe ${row.colorId}: mehrdeutige Farbe braucht eine Auswahl.`;
      else choice = { listId: inventory.id, rowId: row.id, ldrawId: part.ldrawId, colorCode: color.ldrawCode };
    }
    return [{ rowId: row.id, partId: row.partId, quantity, choice, issue }];
  });
}
export function requireAvailable(document: BuilderDocument, allocation: Allocation) {
  const row = document.inventory?.id === allocation.listId ? document.inventory.rows.find(r => r.id === allocation.rowId) : undefined;
  if (!row || row.itemType !== "P") throw new Error("Diese Teilelisten-Auswahl ist nicht mehr gültig. Bitte neu auswählen.");
  if ((allocatedCounts(document).get(row.id) ?? 0) >= row.quantity) throw new Error(`BrickLink ${row.partId}, Farbe ${row.colorId}: Bestand aufgebraucht.`);
  return row;
}
export function replaceInventory(document: BuilderDocument, inventory: Inventory): BuilderDocument {
  const checked = inventorySchema.parse(inventory);
  if ((document.imported?.instances ?? []).some(i => i.allocation)) throw new Error("Liste kann erst ersetzt werden, wenn alle daraus verbauten Teile entfernt wurden. Alternativ ein neues Projekt beginnen.");
  const next = { ...document, inventory: checked, updatedAt: new Date().toISOString() };
  validateInventory(next);
  return next;
}
export function validateInventory(document: BuilderDocument): void {
  if (document.inventory) {
    inventorySchema.parse(document.inventory);
    if (new Set(document.inventory.rows.map(r => r.id)).size !== document.inventory.rows.length) throw new Error("Doppelte Teilelisten-Zeilen.");
  }
  const instances = document.imported?.instances ?? [];
  if (new Set(instances.map(i => i.id)).size !== instances.length) throw new Error("Doppelte Instanz-IDs.");
  const rows = new Map(document.inventory?.rows.map(row => [row.id, row]));
  const counts = new Map<string, number>();
  for (const instance of instances) {
    if (instance.allocation === undefined) continue;
    const allocation = allocationSchema.parse(instance.allocation);
    const row = rows.get(allocation.rowId);
    if (!row || row.itemType !== "P" || allocation.listId !== document.inventory?.id) throw new Error("Verwaiste Teilelisten-Zuordnung.");
    const count = (counts.get(row.id) ?? 0) + 1;
    if (count > row.quantity) throw new Error("Teilelisten-Menge überschritten.");
    counts.set(row.id, count);
  }
}
