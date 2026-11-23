import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { ImportedModel } from "../formats/types";
import { createEmptyDocument, type Brick } from "../editor/model";
import { constructionTransform } from "../connections/engine";
import { describeConnections } from "../connections/description";
import { parseLDraw } from "../formats/ldraw/parser";
import { connectionFixture, partLine } from "../connections/fixtures";
import { generateAutomaticInstructionSteps } from "./auto-generate";
import { readZip, writeZip } from "../formats/zip";
import { exportIO } from "../formats/io/export";
import { sourceInstructionPlan } from "./model";
import { readStudioInstructions } from "./studio";

const plateLibrary = JSON.parse(readFileSync(
  new URL("../../../public/parts/ldraw-plates-2026-10-31.json", import.meta.url),
  "utf8",
)) as { files: { path: string; content: string }[] };
const brickLibrary = JSON.parse(readFileSync(
  new URL("../../../public/parts/ldraw-bricks-2026-10-31.json", import.meta.url),
  "utf8",
)) as { files: { path: string; content: string }[] };
const supportGeometry = readFileSync(new URL("../connections/fixtures/3795.dat", import.meta.url), "utf8");
const brick = (id: string, type: Brick["type"], y: number, x = 0): Brick => ({
  id, type, color: "#ff0000", x, y, z: 0, rotation: 0,
});

describe("automatic instruction sequencing", () => {
  it("puts confirmed native support bricks before the parts resting on them", async () => {
    const document = createEmptyDocument();
    document.bricks = [
      brick("top", "brick-1x2", 2.4),
      brick("middle", "brick-2x2", 1.2),
      brick("base", "brick-2x4", 0),
    ];
    const result = await generateAutomaticInstructionSteps(document);
    expect(result.steps.map(step => step.partIds)).toEqual([["base"], ["middle"], ["top"]]);
    expect(result.unconnectedPartIds).toEqual([]);
    expect(result.fallbackPartIds).toEqual([]);
  });

  it("orders a connected imported support before its upper plate", async () => {
    const model = connectionFixture([partLine("3795", 0, -8), partLine("3023b", 160, -8)].join("\n"));
    const catalogResources = Object.fromEntries(plateLibrary.files.map(file => [file.path, file])) as ImportedModel["resources"];
    model.resources = {
      ...model.resources,
      ...catalogResources,
      "parts/3795.dat": { ...catalogResources["parts/3020.dat"], path: "parts/3795.dat", content: supportGeometry },
    };
    const baseId = model.instances[0].id;
    const plateId = model.instances[1].id;
    const snapped = constructionTransform(model, plateId, { x: 0.03, y: 0.4, z: 0.52 });
    const document = createEmptyDocument();
    document.imported = {
      ...model,
      instances: model.instances.map(instance => instance.id === plateId
        ? { ...instance, matrix: snapped.matrix }
        : instance),
    };

    const result = await generateAutomaticInstructionSteps(document);
    expect(result.steps.flatMap(step => step.partIds)).toEqual([baseId, plateId]);
    expect(result.steps.map(step => step.partIds)).toEqual([[baseId], [plateId]]);
    expect(result.unconnectedPartIds).toEqual([]);
  });

  it("orders an imported standard brick base before its snapped upper brick", async () => {
    const model = connectionFixture([partLine("3001", 0, -24), partLine("3004", 160, -8)].join("\n"));
    model.resources = {
      ...model.resources,
      ...Object.fromEntries([...brickLibrary.files, ...plateLibrary.files].map(file => [file.path, file])),
    };
    const [base, upper] = model.instances;
    const stud = describeConnections("3001.dat", model).connectors.find(connector => connector.gender === "M" && connector.clearId === "studC")!;
    const socket = describeConnections("3004.dat", model).connectors.find(connector =>
      connector.gender === "F" && connector.sections.some(section => section.radius === 6),
    )!;
    const snapped = constructionTransform(model, upper.id, {
      x: (stud.frame[3] - socket.frame[3]) / 20 + 0.01,
      y: (24 + socket.frame[7]) / 20,
      z: (stud.frame[11] - socket.frame[11]) / 20 + 0.01,
    });
    expect(snapped.contacts.length).toBeGreaterThan(0);
    const document = createEmptyDocument();
    document.imported = {
      ...model,
      instances: model.instances.map(instance => instance.id === upper.id
        ? { ...instance, matrix: snapped.matrix }
        : instance),
    };
    const result = await generateAutomaticInstructionSteps(document);
    expect(result.steps.map(step => step.partIds)).toEqual([[base.id], [upper.id]]);
  });

  it("keeps unconnected and geometry-missing parts in the generated result with diagnostics", async () => {
    const source = `${partLine("3001")}\n${partLine("3004", 240)}\n`;
    const document = createEmptyDocument();
    document.imported = {
      version: 1, format: "ldr", sourceName: "unconnected.ldr", originalBytes: [],
      sourceText: source, ...parseLDraw(source), resources: {}, legalDocuments: [],
    };
    document.imported.instances[0].part.status = "resolved";
    document.imported.instances[1].part.status = "missing";
    const result = await generateAutomaticInstructionSteps(document);
    expect(result.steps.flatMap(step => step.partIds)).toHaveLength(2);
    expect(new Set(result.steps.flatMap(step => step.partIds)).size).toBe(2);
    expect(result.unconnectedPartIds).toHaveLength(2);
    expect(result.missingGeometryPartIds).toEqual([document.imported.instances[1].id]);
  });

  it("keeps generated steps within their part-count limit", async () => {
    const document = createEmptyDocument();
    document.bricks = Array.from({ length: 12 }, (_, index) => brick(`stack-${index}`, "brick-1x2", index * 1.2));
    const result = await generateAutomaticInstructionSteps(document);
    expect(result.steps.flatMap(step => step.partIds)).toHaveLength(document.bricks.length);
    expect(result.steps.every(step => step.partIds.length <= 8)).toBe(true);
  });

  it("honors cancellation before analyzing the model", async () => {
    const document = createEmptyDocument();
    document.bricks = [brick("base", "brick-2x4", 0)];
    const controller = new AbortController();
    controller.abort();
    await expect(generateAutomaticInstructionSteps(document, controller.signal)).rejects.toHaveProperty("name", "AbortError");
  });

  it("exports generated IO steps while keeping the original Studio instruction file as a backup", async () => {
    const source = `${partLine("3001")}\n0 STEP\n${partLine("3004", 40)}\n`;
    const xml = "<Instruction><Pages><Page><Slot><Step SerializedIndex='0'/></Slot></Page></Pages></Instruction>";
    const originalBytes = writeZip({
      "model.ldr": new TextEncoder().encode(source),
      "model.ins": new TextEncoder().encode(xml),
    });
    const document = createEmptyDocument();
    document.imported = {
      version: 1, format: "io", sourceName: "build.io", originalBytes: [...originalBytes],
      sourceText: source, ...parseLDraw(source), resources: {}, legalDocuments: [],
    };
    document.instructions = readStudioInstructions(xml, sourceInstructionPlan(document.imported));
    const generated = await generateAutomaticInstructionSteps(document);
    document.instructions = {
      ...document.instructions,
      source: "manual",
      edited: true,
      steps: generated.steps,
      warnings: [],
      studioLayout: undefined,
    };

    const entries = readZip(exportIO(document), { names: ["model.ldr", "model.ins", "BrickBuilder/original/model.ins"] });
    expect(new TextDecoder().decode(entries["BrickBuilder/original/model.ins"])).toBe(xml);
    expect(new TextDecoder().decode(entries["model.ldr"]).match(/^\s*0 STEP\s*$/gm)).toHaveLength(generated.steps.length + 1);
    expect(new TextDecoder().decode(entries["model.ins"])).not.toBe(xml);
  });
});
