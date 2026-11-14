import { afterEach, expect, it } from "vitest";
import { createEmptyDocument } from "@/features/editor/model";
import { installCatalogIndex } from "@/features/catalog/state";
import { parseInventory } from "@/features/inventory/import";
import { BRICKLINK_EVIDENCE } from "@/features/parts/bricklink-evidence";
import { IDENTITY } from "../ldraw/parser";
import type { ImportedInstance } from "../types";
import { BrickLinkExportError, exportBrickLink } from "./export";

export function fixture(...entries: [string, string][]) {
  const document = createEmptyDocument("Mein Modell");
  document.imported = { version: 1, format: "io", sourceName: "model.io",
    sourceText: "", originalBytes: [1, 2, 3], root: "model.ldr", sections: {},
    resources: {}, issues: [], legalDocuments: [],
    instances: entries.map(([reference, colorCode], index): ImportedInstance => ({
      id: String(index), reference, colorCode, matrix: [...IDENTITY], sourcePath: [],
      part: { ldrawId: reference.replace(".dat", ""), status: "missing" },
    })),
  };
  return document;
}
afterEach(() => installCatalogIndex());
const text = (document: ReturnType<typeof fixture>) => new TextDecoder().decode(exportBrickLink(document));

it("aggregates placed parts by confirmed BrickLink ID and color, including missing geometry", () => {
  const document = fixture(["3023b.dat", "4"], ["3023b.dat", "4"], ["3023b.dat", "15"], ["60897.dat", "288"]);
  const before = JSON.stringify(document);
  const xml = text(document);
  const rows = parseInventory(xml, "wanted.xml").rows;
  expect(rows.map(row => [row.partId, row.colorId, row.quantity])).toEqual([
    ["3023", "1", 1], ["3023", "5", 2], ["4085d", "80", 1],
  ]);
  expect(xml).toContain("<MINQTY>2</MINQTY>");
  expect(xml).not.toMatch(/<CONDITION>|<PRICE>|<WANTEDLISTID>|<QTY>/);
  expect(JSON.stringify(document)).toBe(before);
});

it("counts edited instances rather than the original archive, resources or inventory stock", () => {
  const document = fixture(["3069b.dat", "297"], ["3069b.dat", "297"]);
  document.imported!.instances.pop();
  document.imported!.instances[0].colorCode = "8";
  document.inventory = {
    version: 1, id: "stock", name: "Unplaced stock", importedAt: new Date().toISOString(),
    rows: [{ id: "unused", partId: "3001", colorId: "5", itemType: "P",
      quantity: 999, sourceRows: [1], metadata: [] }],
  };
  expect(parseInventory(text(document), "edited.xml").rows.map(row => [row.partId, row.colorId, row.quantity]))
    .toEqual([["3069", "10", 1]]);
});

it("uses the current raw color rather than stale saved appearance", () => {
  const document = fixture(["3023b.dat", "4"]);
  document.imported!.instances[0].color = {
    ldrawCode: "15", name: "White", hex: "#FFFFFF", alpha: 255, brickLinkId: 1, source: "old snapshot",
  };
  expect(text(document)).toContain("<COLOR>5</COLOR>");
});

it("blocks the entire export and aggregates unknown parts instead of guessing from filenames", () => {
  const document = fixture(["3023b.dat", "4"], ["5844.dat", "4"], ["5844.dat", "4"]);
  try { exportBrickLink(document); throw new Error("Expected an explicit mapping error"); }
  catch (error) {
    expect(error).toBeInstanceOf(BrickLinkExportError);
    expect((error as BrickLinkExportError).issues).toEqual([
      { reference: "5844.dat", color: "LDraw 4", quantity: 2, reason: "Teilenummer fehlt oder ist mehrdeutig" },
    ]);
  }
});

it("rejects ambiguous parts and unconfirmed direct RGB colors", () => {
  const document = fixture(["3023b.dat", "4"]);
  document.imported!.instances[0].part.mapping = {
    status: "confirmed", candidates: [{ ...BRICKLINK_EVIDENCE[1], brickLinkId: "different-variant" }],
  };
  expect(() => exportBrickLink(document)).toThrow(BrickLinkExportError);
  expect(() => exportBrickLink(fixture(["3023b.dat", "0x2B40000"]))).toThrow(BrickLinkExportError);
});

it("does not accept a cached conflicting color as a definite purchase color", () => {
  const document = fixture(["3023b.dat", "4"]);
  document.imported!.instances[0].color = {
    ldrawCode: "4", name: "Red", hex: "#B40000", alpha: 255, brickLinkId: 7, source: "saved catalog",
    catalog: { status: "confirmed", version: "saved", rebrickableIds: [], brickLinkIds: [7] },
  };
  expect(() => exportBrickLink(document)).toThrow(BrickLinkExportError);
});

it("rejects empty models and never guesses a legacy custom RGB color", () => {
  expect(() => exportBrickLink(createEmptyDocument())).toThrow("keine Teile");
  const document = createEmptyDocument();
  document.bricks.push({ id: "legacy", type: "brick-1x2", color: "#d75b3f", x: 0, y: 0, z: 0, rotation: 0 });
  expect(() => exportBrickLink(document)).toThrow(BrickLinkExportError);
});
