import { expect, it } from "vitest";
import { createEmptyDocument } from "../editor/model";
import { parseLDraw } from "../formats/ldraw/parser";
import { effectiveInstructions, sourceInstructionPlan } from "./model";
import { readStudioInstructions } from "./studio";
import { writeZip } from "../formats/zip";
import { includeIOAssemblies } from "../formats/io/assemblies";

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

it("includes callout-only steps when validating Studio's serialized sequence", () => {
  const document = fixture();
  const layout = `<Instruction><Pages><Page><Slot><Step SerializedIndex="2">
    <StepPreview modelAngle="0 1 0"/><CallOut><CallOutItemData>
    <CallOutStepItemData><Step SerializedIndex="0"/></CallOutStepItemData>
    <CallOutStepItemData><Step SerializedIndex="1"/></CallOutStepItemData>
    </CallOutItemData></CallOut></Step></Slot></Page>${[3, 4].map(index =>
    `<Page><Slot><Step SerializedIndex="${index}"/></Slot></Page>`).join("")}</Pages></Instruction>`;
  const plan = readStudioInstructions(layout, document.instructions!);
  expect(plan.warnings).toEqual([]);
  expect(plan.steps.find(step => step.sourceIndex === 2)!.rotation![1]).toBeCloseTo(180 / Math.PI);
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

it("keeps direct parts and nested assemblies in one source step without shifting later indices", () => {
  const text = [
    "0 FILE main.ldr",
    "1 15 0 0 0 1 0 0 0 1 0 0 0 1 3001.dat",
    "1 16 80 0 0 1 0 0 0 1 0 0 0 1 child.ldr", "0 STEP",
    "1 16 160 0 0 1 0 0 0 1 0 0 0 1 child.ldr",
    "1 1 200 0 0 1 0 0 0 1 0 0 0 1 3710.dat", "0 STEP",
    "1 4 240 0 0 1 0 0 0 1 0 0 0 1 3020.dat", "0 STEP",
    "0 FILE child.ldr",
    "1 4 0 0 0 1 0 0 0 1 0 0 0 1 3020.dat", "0 STEP",
  ].join("\n");
  const document = fixture();
  document.imported = { ...document.imported!, sourceText: text, ...parseLDraw(text) };
  const plan = sourceInstructionPlan(document.imported);
  expect(plan.steps.map(step => step.sourceIndex)).toEqual([0, 1, 0, 2, 3]);
  expect(plan.steps.map(step => step.sourceAssembly)).toEqual([[1], [], [3], [], []]);
  expect(plan.steps[1].partIds).toEqual([document.imported.instances[0].id]);
  expect(plan.steps[1].callouts?.[0].occurrence).toEqual([1]);
  expect(plan.steps[3].callouts?.[0].occurrence).toEqual([3]);
  expect(new Set(plan.steps.flatMap(step => step.partIds))).toEqual(
    new Set(document.imported.instances.map(part => part.id)));
  const layout = `<Instruction><Pages>${[0, 1, 2, 3].map(index =>
    `<Page><Slot><Step SerializedIndex="${index}"/></Slot></Page>`).join("")}</Pages></Instruction>`;
  expect(readStudioInstructions(layout, plan).warnings).toEqual([]);
});

it("keeps expanded custom parts atomic in Studio indices, including previously saved projects", () => {
  const original = [
    "0 FILE main.ldr",
    "1 16 0 0 0 1 0 0 0 1 0 0 0 1 group.dat", "0 STEP",
    "1 4 80 0 0 1 0 0 0 1 0 0 0 1 3001.dat", "0 STEP",
    "1 16 160 0 0 1 0 0 0 1 0 0 0 1 group.dat", "0 STEP",
  ].join("\n");
  const assembly = [
    "0 CustomBrick",
    "1 71 0 0 0 1 0 0 0 1 0 0 0 1 3020.dat", "0 STEP",
    "1 0 0 -8 0 1 0 0 0 1 0 0 0 1 3710.dat",
  ];
  const bytes = new TextEncoder().encode(original);
  const sourceText = new TextDecoder().decode(includeIOAssemblies(bytes, { "group.dat": assembly }));
  const document = fixture();
  document.imported = { ...document.imported!, sourceText, ...parseLDraw(sourceText),
    originalBytes: Array.from(writeZip({ "model.ldr": bytes,
      "CustomParts/group.dat": new TextEncoder().encode(assembly.join("\n")) })) };
  const plan = sourceInstructionPlan(document.imported);
  expect(plan.steps.map(step => step.sourceIndex)).toEqual([0, 1, 2]);
  expect(plan.steps.map(step => step.sourceAssembly)).toEqual([[], [], []]);
  expect(plan.steps.map(step => step.partIds.length)).toEqual([2, 1, 2]);
  expect(plan.steps.every(step => !step.callouts?.length)).toBe(true);
  document.instructions = readStudioInstructions(
    `<Instruction><Pages>${[0, 1, 2].map(index =>
      `<Page><Slot><Step SerializedIndex="${index}"/></Slot></Page>`).join("")}</Pages></Instruction>`, plan);
  expect(effectiveInstructions(document).steps).toEqual(document.instructions.steps);
});
