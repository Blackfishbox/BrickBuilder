import { describe, expect, it } from "vitest";
import type { Brick } from "../editor/model";
import { constructionTransform } from "./engine";
import { connectedPartsAbove } from "./connected-move";
import { connectionFixture, partLine } from "./fixtures";
import type { ImportedModel } from "../formats/types";
import { readFileSync } from "node:fs";

const plateLibrary = JSON.parse(readFileSync(
  new URL("../../../public/parts/ldraw-plates-2026-10-31.json", import.meta.url),
  "utf8",
)) as { files: { path: string; content: string }[] };
const supportGeometry = readFileSync(new URL("./fixtures/3795.dat", import.meta.url), "utf8");

describe("moving connected parts above a selected part", () => {
  it("moves native bricks that form a vertical stack, but not the support or nearby parts", () => {
    const bricks: Brick[] = [
      { id: "base", type: "brick-2x4", color: "#fff", x: 0, y: 0, z: 0, rotation: 0 },
      { id: "middle", type: "brick-1x2", color: "#fff", x: 0, y: 1.2, z: 0, rotation: 0 },
      { id: "top", type: "brick-1x2", color: "#fff", x: 0, y: 2.4, z: 0, rotation: 0 },
      { id: "lower", type: "brick-1x2", color: "#fff", x: 0, y: -1.2, z: 0, rotation: 0 },
      { id: "beside", type: "brick-1x2", color: "#fff", x: 4, y: 1.2, z: 0, rotation: 0 },
    ];

    expect(connectedPartsAbove(undefined, bricks, ["base"])).toEqual(new Set(["base", "middle", "top"]));
    expect(connectedPartsAbove(undefined, bricks, ["middle"])).toEqual(new Set(["middle", "top"]));
    expect(connectedPartsAbove(undefined, bricks, ["top"])).toEqual(new Set(["top"]));
  });

  it("follows verified stud connections upward, not downward to the supporting plate", () => {
    const model = connectionFixture([
      partLine("3795", 0, -8),
      partLine("3023b", 160, -8),
    ].join("\n"));
    const catalogResources = Object.fromEntries(plateLibrary.files.map(file => [file.path, file])) as ImportedModel["resources"];
    model.resources = {
      ...model.resources,
      ...catalogResources,
      "parts/3795.dat": {
        ...catalogResources["parts/3020.dat"],
        path: "parts/3795.dat",
        content: supportGeometry,
      },
    };
    const baseId = model.instances[0].id;
    const plateId = model.instances[1].id;
    const snapped = constructionTransform(model, plateId, { x: 0.03, y: 0.4, z: 0.52 });
    const connected: ImportedModel = {
      ...model,
      instances: model.instances.map(instance => instance.id === plateId
        ? { ...instance, matrix: snapped.matrix }
        : instance),
    };

    expect(connectedPartsAbove(connected, [], [baseId])).toEqual(new Set([baseId, plateId]));
    expect(connectedPartsAbove(connected, [], [plateId])).toEqual(new Set([plateId]));
  });
});
