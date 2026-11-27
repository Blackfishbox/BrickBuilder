import { describe, expect, it } from "vitest";
import { Color, Mesh, SRGBColorSpace } from "three";
import { DARK_PART_LUMINANCE, needsWhiteEdges, partEdgeColor } from "./edge-contrast";
import { createImportedGroup, disposeImportedScene } from "./imported-scene";
import { engineFixture } from "./engine-fixtures";
import { createLocalBrickEdgeBatches } from "./local-brick-edge-batches";
import { InstanceIndex } from "./instance-index";
import { wideLineMaterial } from "./wide-lines";
import { resolveColor } from "../formats/colors";

it.each(["#000000", "#05131d", "#333333", "#0a3463", "#330000", "#143020"])(
  "uses unlit white edges and a white thick-edge core on very dark %s", hex => {
    const color = new Color(hex), before = color.clone();
    expect(needsWhiteEdges(color)).toBe(true);
    for (const thick of [false, true]) {
      for (const shade of [0.2, 1, 2]) expect(partEdgeColor(color, thick, shade).getHexString()).toBe("ffffff");
    }
    expect(color).toEqual(before);
  },
);
it.each(["#ffffff", "#777777", "#B40000", "#1E5AA8", "#00ff00", "#0000ff"])(
  "keeps black standard edges and shaded thick outer strokes on %s", hex => {
    const color = new Color(hex);
    expect(needsWhiteEdges(color)).toBe(false);
    expect(partEdgeColor(color).getHexString()).toBe("000000");
    expect(partEdgeColor(color, true, 0.5)).toEqual(color.clone().multiplyScalar(0.5));
  },
);
it("has a deterministic linear-sRGB boundary and preserves active colors instead of red edge ink", () => {
  expect(needsWhiteEdges(new Color().setRGB(DARK_PART_LUMINANCE - 1e-6, DARK_PART_LUMINANCE, DARK_PART_LUMINANCE))).toBe(true);
  expect(needsWhiteEdges(new Color().setRGB(DARK_PART_LUMINANCE + 1e-6, DARK_PART_LUMINANCE, DARK_PART_LUMINANCE))).toBe(false);
  const material = wideLineMaterial();
  expect(material.fragmentShader).toContain("partContrastColor(baseColor)");
  expect(material.fragmentShader).not.toContain("vec4(0.6, 0.015, 0.01");
  material.dispose();
});

describe.each(["wide", "thin", "legacy"] as const)("%s imported contrast buffers", mode => {
  it("preserves inherited and fixed source appearances with bounded fallback attributes", () => {
    const model = engineFixture(2, 1);
    model.instances[0].colorCode = "0";
    model.instances[1].colorCode = "14";
    model.resources["parts/test.dat"].content += "\n3 0 0 0 0 20 0 0 0 0 20\n2 24 0 0 0 0 0 20";
    const root = createImportedGroup(model, { compactFaces: false, edges: mode });
    try {
      const edge = root.getObjectByName("ldraw:instanced-edges") as Mesh;
      expect(edge.geometry.getAttribute("instanceEdgeColor").array).toBeInstanceOf(Uint8Array);
      if (mode !== "wide") {
        const ink = edge.geometry.getAttribute("edgeContrastOverride");
        expect(ink.array).toBeInstanceOf(Uint8Array);
        expect(ink.count).toBe(edge.geometry.getAttribute("position").count);
        expect([...ink.array]).toContain(2); // Occurrence paint.
        expect([...ink.array]).toContain(0); // Fixed green.
        expect([...ink.array]).toContain(1); // Fixed black.
        expect(edge.geometry.hasAttribute("edgeNormal")).toBe(false);
      }
    } finally { disposeImportedScene(root); }
  });
  it("keeps edge colors current through repaint, growth, swap deletion and restoration", () => {
    const model = engineFixture(2, 1);
    model.instances[0].colorCode = "0";
    const root = createImportedGroup(model, { compactFaces: false, edges: mode });
    const index = new InstanceIndex(root, model);
    const verify = () => {
      for (const entry of index.records.values()) {
        const expected = new Color(resolveColor(entry.instance.colorCode)!.hex);
        for (const slot of entry.slots) {
          if (!slot.draw.geometry.hasAttribute("instanceEdgeColor")) continue;
          const attribute = slot.draw.geometry.getAttribute("instanceEdgeColor");
          expect(attribute.count).toBeGreaterThanOrEqual(slot.index + 1);
          const encoded = expected.getHex(SRGBColorSpace);
          expect(attribute.getX(slot.index)).toBeCloseTo(((encoded >> 16) & 255) / 255, 3);
          expect(attribute.getY(slot.index)).toBeCloseTo(((encoded >> 8) & 255) / 255, 3);
          expect(attribute.getZ(slot.index)).toBeCloseTo((encoded & 255) / 255, 3);
        }
      }
    };
    try {
      verify();
      const repainted = { ...model, instances: model.instances.map(part => ({ ...part, colorCode: "14" })) };
      expect(index.update(repainted)).toBe(true); verify();
      const more = { ...model, instances: [...model.instances, ...Array.from({ length: 6 }, (_, i) =>
        ({ ...model.instances[0], id: `extra-${i}`, colorCode: i % 2 ? "4" : "0" }))] };
      expect(index.update(more)).toBe(true); verify();
      expect(index.update({ ...more, instances: more.instances.slice(1) })).toBe(true); verify();
      expect(index.update(model)).toBe(true); verify();
    } finally { disposeImportedScene(root); }
  });
});

it.each([false, true])("carries local brick colors through normal/legacy batches (legacy=%s)", legacy => {
  const batches = createLocalBrickEdgeBatches([
    { id: "black", type: "brick-2x2", color: "#05131d", x: 0, y: 0, z: 0, rotation: 0 },
    { id: "white", type: "brick-2x2", color: "#ffffff", x: 3, y: 0, z: 0, rotation: 0 },
  ], legacy);
  try {
    expect(batches).toHaveLength(1);
    expect(batches[0].geometry.getAttribute("instanceEdgeColor").count).toBe(2);
  } finally { batches.forEach(batch => { batch.geometry.dispose(); (batch.material as ReturnType<typeof wideLineMaterial>).dispose(); }); }
});
