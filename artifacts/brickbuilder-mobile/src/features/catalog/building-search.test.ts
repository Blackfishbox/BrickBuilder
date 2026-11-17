import { expect, it } from "vitest";
import { searchCatalog, searchCatalogPage, type CatalogData } from "./data";

const data: CatalogData = {
  schema: 1, version: "synthetic", attribution: "Synthetic search records", sources: {},
  parts: Array.from({ length: 85 }, (_, i) => [`rb${i}`, `Cone ${i} with a long name`, "20", "Plastic"])
    .concat([["figure", "Minifig Head Cone Pattern", "59", "Plastic"]]),
  colors: [], color_mappings: [],
  part_mappings: Array.from({ length: 85 }, (_, i) => [
    [`rb${i}`, "BL", `bl${i}`, "True", "True"],
    [`rb${i}`, "LD", `ld${i}`, "True", "True"],
  ]).flat(),
};

it("pages all metadata matches beyond the legacy sixty-result limit", () => {
  const first = searchCatalogPage(data, "cone", "parts");
  expect(first.total).toBe(86);
  expect(first.results).toHaveLength(40);
  const pages = [first, searchCatalogPage(data, "cone", "parts", 40), searchCatalogPage(data, "cone", "parts", 80)];
  expect(new Set(pages.flatMap(page => page.results.map(row => row.id))).size).toBe(86);
  expect(searchCatalog(data, "cone", "parts")).toHaveLength(60);
});

it("matches BrickLink and LDraw identifiers and retains missing or directional mappings", () => {
  expect(searchCatalogPage(data, "bl84", "parts").results[0]).toMatchObject({ id: "rb84", mappings: [
    ["rb84", "BL", "bl84", "True", "True"], ["rb84", "LD", "ld84", "True", "True"],
  ] });
  expect(searchCatalogPage(data, "ld84", "parts").results[0].id).toBe("rb84");
  expect(searchCatalogPage(data, "figure", "parts").results[0].mappings).toEqual([]);
  expect(searchCatalogPage(data, "missing", "parts")).toEqual({ results: [], total: 0 });
});

it("uses the existing building-category names without treating every cone pattern as a cone part", () => {
  expect(searchCatalogPage(data, "cone", "parts", 0, 40, "Schrägsteine").total).toBe(85);
  expect(searchCatalogPage(data, "cone", "parts", 0, 40, "Platten").total).toBe(0);
  expect(searchCatalogPage(data, "cone", "parts", -10, 999).results).toHaveLength(60);
});

it("matches touch-friendly dimension searches with or without spaces and multiplication signs", () => {
  const dimensions = { ...data, parts: [["size", "Cone 1 x 1 Inverted", "20", "Plastic"]] };
  expect(searchCatalogPage(dimensions, "cone 1x1", "parts").total).toBe(1);
  expect(searchCatalogPage(dimensions, "cone 1×1", "parts").total).toBe(1);
});
