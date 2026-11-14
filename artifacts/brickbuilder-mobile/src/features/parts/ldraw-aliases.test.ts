import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { builderDatabase } from "@/storage/database";
import { installCatalogIndex } from "../catalog/state";
import { decodeCatalog, indexCatalog, type CatalogIndex } from "../catalog/data";
import { resolvePartMapping } from "./bricklink-evidence";
import snapshot from "./ldraw-aliases.json";
import { createEmptyDocument } from "../editor/model";
import { IDENTITY } from "../formats/ldraw/parser";
import { exportBrickLink } from "../formats/bricklink/export";
import { importIO } from "../formats/io/import";
import { parseInventory } from "../inventory/import";
import geometry from "../formats/geometry-manifest.json";
import catalog from "../catalog/manifest.json";

function installTargets() {
  installCatalogIndex({
    parts: {
      "60481a": [{ rb: "60481", name: "Sloped brick", bl: ["60481"] }],
      "2654a": [{ rb: "2654", name: "Boat stud", bl: ["2654"] }],
      "3665a": [{ rb: "3665", name: "Inverted slope", bl: ["3665"] }],
    }, colors: {}, allColors: [], coverage: {} as CatalogIndex["coverage"],
  });
}
afterEach(async () => { installCatalogIndex(); vi.unstubAllGlobals(); await builderDatabase.delete(); });

it("follows explicit official moved-to aliases and retains both evidence sources", () => {
  installTargets();
  for (const id of ["60481", "2654", "3665"]) {
    const mapping = resolvePartMapping(`${id}.dat`);
    expect(mapping.status).toBe("confirmed");
    expect(mapping.candidates[0].brickLinkId).toBe(id);
    expect(mapping.candidates[0].ldrawId).toBe(id);
    expect(mapping.candidates[0].sourceLine).toContain(`LD,${id}a,`);
    expect(mapping.candidates[0].sourceLine).toContain(`0 ~Moved to ${id}a`);
    expect(mapping.candidates[0].sourceLine).toContain(`/official/parts/${id}.dat`);
    expect(mapping.candidates[0].license).toBe("Rebrickable-Attribution");
  }
  expect(resolvePartMapping("2654-invented.dat").status).toBe("unknown");
  expect(resolvePartMapping("parts/2654.dat").status).toBe("unknown");
});

it("retains conflicts with direct evidence and does not grow saved alias evidence on refresh", () => {
  installTargets();
  const prior = resolvePartMapping("2654.dat").candidates;
  expect(resolvePartMapping("2654.dat", [], prior).candidates).toEqual(prior);
  expect(resolvePartMapping("2654.dat", [], [{ ...prior[0], brickLinkId: "other" }]).status).toBe("ambiguous");
});

it("pins only identity, inherited-color, single-reference moved-to aliases", () => {
  const index = new Map(snapshot.aliases.map(alias => [alias.from, alias]));
  expect(index.size).toBe(snapshot.aliases.length);
  for (const alias of snapshot.aliases) {
    expect(alias.header.toLowerCase()).toBe(`0 ~moved to ${alias.to}`);
    const tokens = alias.referenceLine.trim().split(/\s+/);
    expect(tokens.slice(0, 2)).toEqual(["1", "16"]);
    expect(tokens.slice(2, 14).map(Number)).toEqual([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1]);
    expect(tokens[14].toLowerCase()).toBe(`${alias.to}.dat`);
    expect(alias.sha256).toMatch(/^[a-f0-9]{64}$/);
    const seen = new Set<string>();
    let id = alias.from;
    while (index.has(id)) { expect(seen.has(id)).toBe(false); seen.add(id); id = index.get(id)!.to; }
  }
});

it("exports the seven reported placed instances with the right IDs, colors and quantities", () => {
  installTargets();
  const document = createEmptyDocument();
  document.imported = { version: 1, format: "io", sourceName: "synthetic.io", sourceText: "",
    originalBytes: [], root: "", sections: {}, resources: {}, legalDocuments: [], issues: [],
    instances: [["60481", "4", 2], ["2654", "1", 1], ["3665", "15", 4]].flatMap(([id, color, count]) =>
      Array.from({ length: Number(count) }, (_, n) => ({
        id: `${id}-${n}`, reference: `${id}.dat`, colorCode: String(color), matrix: IDENTITY,
        sourcePath: [], part: { ldrawId: String(id), status: "missing" as const },
      }))),
  };
  const rows = parseInventory(new TextDecoder().decode(exportBrickLink(document)), "fixed.xml").rows;
  expect(rows.map(row => [row.partId, row.colorId, row.quantity])).toEqual([
    ["2654", "7", 1], ["3665", "1", 4], ["60481", "5", 2],
  ]);
});

it.skipIf(!process.env.BRICKBUILDER_IO_REFERENCE || !process.env.BRICKBUILDER_CATALOG_REFERENCE)(
  "exports the complete optional private IO with real catalog data, without changing its source", async () => {
    const catalogBytes = new Uint8Array(readFileSync(process.env.BRICKBUILDER_CATALOG_REFERENCE!));
    expect(createHash("sha256").update(catalogBytes).digest("hex")).toBe(catalog.sha256);
    installCatalogIndex(indexCatalog(decodeCatalog(catalogBytes)));
    await builderDatabase.open();
    const bundle = new Uint8Array(readFileSync(new URL(`../../../public/${geometry.url}`, import.meta.url)));
    vi.stubGlobal("fetch", vi.fn(async () => new Response(bundle)));
    const bytes = new Uint8Array(readFileSync(process.env.BRICKBUILDER_IO_REFERENCE!));
    const document = await importIO(bytes, "private-reference.io", { online: false });
    const before = JSON.stringify(document);
    const rows = parseInventory(new TextDecoder().decode(exportBrickLink(document)), "private-wanted.xml").rows;
    for (const [partId, colorId, quantity] of [["60481", "153", 2], ["2654", "7", 1], ["3665", "1", 4]] as const) {
      expect(rows.find(row => row.partId === partId && row.colorId === colorId)?.quantity).toBe(quantity);
    }
    expect(rows.reduce((sum, row) => sum + row.quantity, 0)).toBe(document.imported!.instances.length);
    expect(JSON.stringify(document)).toBe(before);
    expect(document.imported!.originalBytes).toEqual(Array.from(bytes));
  }, 60000,
);
