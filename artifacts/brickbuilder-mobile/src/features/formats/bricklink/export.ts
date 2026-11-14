import { BRICK_DEFINITIONS, type BuilderDocument } from "@/features/editor/model";
import { refreshedCatalogModel } from "@/features/catalog/refresh-model";
import { catalogPalette } from "../colors";
import { resolvePartMapping } from "@/features/parts/bricklink-evidence";

export interface PartsListIssue { reference: string; color: string; quantity: number; reason: string }
export class BrickLinkExportError extends Error {
  constructor(public issues: PartsListIssue[]) {
    super("Keine Datei erstellt: Für Teile oder Farben fehlen eindeutige BrickLink-Zuordnungen. Ein unvollständiger Export würde falsche Mengen liefern.");
    this.name = "BrickLinkExportError";
  }
}
interface Lot { partId: string; colorId: number; quantity: number }

/** Count placed root instances, never geometry primitives or unused inventory. */
export function exportBrickLink(document: BuilderDocument): Uint8Array {
  const lots = new Map<string, Lot>();
  const issues = new Map<string, PartsListIssue>();
  const add = (reference: string, color: string, partId?: string, colorId?: number) => {
    const reason = !partId || !/^[a-z0-9_-]{1,80}$/i.test(partId)
      ? "Teilenummer fehlt oder ist mehrdeutig"
      : colorId === undefined || !Number.isSafeInteger(colorId) || colorId < 0
        ? "BrickLink-Farbe fehlt oder ist mehrdeutig" : undefined;
    if (reason) {
      const key = JSON.stringify([reference, color, reason]);
      const issue = issues.get(key) ?? { reference, color, reason, quantity: 0 };
      issue.quantity++; issues.set(key, issue);
      return;
    }
    const key = JSON.stringify([partId, colorId]);
    const lot = lots.get(key) ?? { partId: partId!, colorId: colorId!, quantity: 0 };
    lot.quantity++; lots.set(key, lot);
  };
  // Re-evaluate saved evidence against the loaded catalog without editing the model.
  const model = document.imported ? refreshedCatalogModel(document.imported) : undefined;
  for (const instance of model?.instances ?? []) {
    const mapping = instance.part.mapping;
    add(instance.reference, `LDraw ${instance.colorCode}`,
      mapping?.status === "confirmed" ? mapping.candidates[0]?.brickLinkId : undefined,
      instance.color?.catalog?.status === "ambiguous" ? undefined : instance.color?.brickLinkId);
  }
  const palette = catalogPalette();
  for (const brick of document.bricks) {
    const reference = `${BRICK_DEFINITIONS[brick.type].ldrawId}.dat`;
    const mapping = resolvePartMapping(reference);
    // Legacy custom RGB colors are never rounded to a nearby purchasable color.
    const colors = new Set(palette.filter(color => color.alpha === 255 &&
      color.hex.toLowerCase() === brick.color.toLowerCase() && color.brickLinkId !== undefined)
      .map(color => color.brickLinkId!));
    add(reference, brick.color, mapping.status === "confirmed" ? mapping.candidates[0]?.brickLinkId : undefined,
      colors.size === 1 ? [...colors][0] : undefined);
  }
  if (issues.size) throw new BrickLinkExportError([...issues.values()]);
  if (!lots.size) throw new Error("Das aktuelle Modell enthält keine Teile zum Exportieren.");
  // No condition, price, wanted-list ID or seller preference is imposed.
  const rows = [...lots.values()].sort((a, b) => a.partId.localeCompare(b.partId, "en") || a.colorId - b.colorId);
  const xml = ['<?xml version="1.0" encoding="UTF-8"?>', "<INVENTORY>",
    ...rows.map(lot => `  <ITEM>\r\n    <ITEMTYPE>P</ITEMTYPE>\r\n    <ITEMID>${lot.partId}</ITEMID>\r\n    <COLOR>${lot.colorId}</COLOR>\r\n    <MINQTY>${lot.quantity}</MINQTY>\r\n  </ITEM>`),
    "</INVENTORY>", ""].join("\r\n");
  return new TextEncoder().encode(xml);
}
