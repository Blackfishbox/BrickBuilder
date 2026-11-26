import { expect, it } from "vitest";
import { createEmptyDocument } from "../editor/model";
import { parseLDraw } from "../formats/ldraw/parser";
import { effectiveInstructions, sourceInstructionPlan } from "./model";
import { readStudioInstructions } from "./studio";

const source = [
  "0 FILE main.ldr",
  "1 16 0 0 0 1 0 0 0 1 0 0 0 1 child.ldr",
  "0 STEP",
  "1 16 80 0 0 1 0 0 0 1 0 0 0 1 child.ldr",
  "0 STEP",
  "1 15 0 0 40 1 0 0 0 1 0 0 0 1 3001.dat",
  "0 STEP",
  "0 FILE child.ldr",
  "1 4 0 0 0 1 0 0 0 1 0 0 0 1 3020.dat",
  "0 STEP",
  "1 1 0 -8 0 1 0 0 0 1 0 0 0 1 3710.dat",
  "0 STEP",
].join("\n");

function fixture() {
  const document = createEmptyDocument();
  document.imported = { version: 1, format: "io", sourceName: "synthetic.io",
    sourceText: source, ...parseLDraw(source), resources: {}, legalDocuments: [] };
  document.instructions = sourceInstructionPlan(document.imported);
  return document;
}

const xml = `<Instruction><Pages>${[0, 1, 2, 3, 4].map(index =>
  `<Page><Slot><Step SerializedIndex="${index}"><StepPreview modelAngle="0 1 0"/></Step></Slot></Page>`
).join("")}</Pages></Instruction>`;

it("counts reused Studio definitions once without dropping any placed occurrences", () => {
  const document = fixture();
  const plan = document.instructions!;
  expect(plan.steps.map(step => step.sourceIndex)).toEqual([0, 1, 2, 0, 1, 3, 4]);
  expect(plan.steps.map(step => step.sourceAssembly)).toEqual([[0], [0], [], [2], [2], [], []]);
  const ids = plan.steps.flatMap(step => step.partIds);
  expect(ids).toHaveLength(5);
  expect(new Set(ids)).toEqual(new Set(document.imported!.instances.map(part => part.id)));
  expect(new Set(plan.steps.map(step => step.id)).size).toBe(plan.steps.length);
});

it("maps source rotations to every occurrence using source indices rather than flattened positions", () => {
  const document = fixture();
  const plan = readStudioInstructions(xml, document.instructions!);
  expect(plan.warnings).toEqual([]);
  expect(plan.steps.every(step => Math.abs(step.rotation![1] - 180 / Math.PI) < 1e-8)).toBe(true);
});

it("repairs untouched saved Studio plans while retaining original layout edits", () => {
  const document = fixture();
  const stored = readStudioInstructions(xml, document.instructions!);
  stored.steps.forEach((step, index) => {
    step.sourceIndex = index;
    delete step.sourceAssembly;
  });
  document.instructions = stored;
  const before = structuredClone(stored);
  const result = effectiveInstructions(document);
  expect(result.steps.map(step => step.sourceIndex)).toEqual([0, 1, 2, 0, 1, 3, 4]);
  expect(result.steps[3].sourceAssembly).toEqual([2]);
  expect(result.studioLayout).toEqual(stored.studioLayout);
  expect(stored).toEqual(before);
});

it("does not reinterpret user-edited instructions", () => {
  const document = fixture();
  document.instructions = readStudioInstructions(xml, document.instructions!);
  document.instructions.edited = true;
  document.instructions.steps[0].partIds = [];
  expect(effectiveInstructions(document).steps[0].partIds).toEqual([]);
});
