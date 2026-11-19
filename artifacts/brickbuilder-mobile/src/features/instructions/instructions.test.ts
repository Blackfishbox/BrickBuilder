import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { createEmptyDocument, normalizeDocument } from "../editor/model";
import { parseLDraw } from "../formats/ldraw/parser";
import { readZip, writeZip } from "../formats/zip";
import { exportIO } from "../formats/io/export";
import { exportInternal, importInternal } from "../formats/internal/adapter";
import { effectiveInstructions, instructionView, sourceInstructionPlan, updateInstructions } from "./model";
import { readStudioInstructions, writeStudioInstructions } from "./studio";
import { exportInstructionPDF } from "./pdf";
import { exportMPD } from "../formats/mpd/export";
import { instructionPlanSchema } from "./types";
import { createSoftwareInstructionRenderer } from "./software-render";
import { instructionCalloutPartIds, instructionHighlightIds } from "./callouts";
import { OrthographicCamera, PerspectiveCamera, Vector3 } from "three";
import {
  applyInstructionCameraRotation,
  DEFAULT_INSTRUCTION_PHI,
  DEFAULT_INSTRUCTION_THETA,
  instructionRotationFromCameraPose,
} from "../engine/instruction-camera";
import { applyPdfStepCamera } from "./camera";

const encode = (text: string) => new TextEncoder().encode(text);
const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
const line = (id = "3004", x = 0) => `1 4 ${x} 0 0 1 0 0 0 1 0 0 0 1 ${id}.dat`;
function fixture(source = `${line()}\n0 STEP\n${line("3003", 40)}\n0 STEP\n`) {
  const document = createEmptyDocument("Anleitung");
  document.imported = {
    version: 1, format: "io", sourceName: "instructions.io",
    originalBytes: Array.from(writeZip({
      "model.ldr": encode(source), "unknown/custom.dat": new Uint8Array([17, 0, 255]),
      "modelv2.ldr": encode("original Studio variant"), ".info": encode('{"parts":999}'),
    })),
    sourceText: source, ...parseLDraw(source), resources: {}, legalDocuments: [],
  };
  document.instructions = sourceInstructionPlan(document.imported);
  return document;
}

describe("local construction instructions", () => {
  it("reads steps, preserves deliberate empty steps and tracks real instance IDs", () => {
    const doc = fixture(`${line()}\n0 STEP\n0 STEP\n${line()}\n0 ROTSTEP 20 30 40 ABS`);
    expect(doc.instructions!.steps.map(step => step.partIds.length)).toEqual([1, 0, 1]);
    expect(doc.instructions!.steps[2].rotation).toEqual([20, 30, 40]);
    expect(instructionView(doc, doc.instructions!, 0).imported!.instances).toHaveLength(1);
    expect(instructionView(doc, doc.instructions!, 2).imported!.instances).toHaveLength(2);
    expect(sourceInstructionPlan(doc.imported!).steps.map(step => step.id)).toEqual(doc.instructions!.steps.map(step => step.id));
  });

  it("distinguishes identical parts inside repeated submodel occurrences", () => {
    const doc = fixture(`0 FILE main.ldr\n1 16 0 0 0 1 0 0 0 1 0 0 0 1 child.ldr\n0 STEP\n1 16 40 0 0 1 0 0 0 1 0 0 0 1 child.ldr\n0 FILE child.ldr\n${line()}\n0 STEP\n`);
    const all = doc.instructions!.steps.flatMap(step => step.partIds);
    expect(new Set(all).size).toBe(2);
    expect(new Set(all)).toEqual(new Set(doc.imported!.instances.map(part => part.id)));
  });

  it("shows a submodel-only parent step as a callout", () => {
    const doc = fixture(`0 FILE main.ldr\n1 16 0 0 0 1 0 0 0 1 0 0 0 1 child.ldr\n0 STEP\n0 FILE child.ldr\n${line()}\n0 STEP\n`);
    const insertion = doc.instructions!.steps.at(-1)!;
    expect(insertion.partIds).toEqual([]);
    expect(insertion.callouts).toHaveLength(1);
    expect(insertion.callouts?.[0].title).toBe("child");
    const ids = instructionCalloutPartIds(doc, insertion.callouts![0]);
    expect(ids).toHaveLength(1);
    expect(instructionHighlightIds(doc, insertion)).toEqual(new Set(ids));
  });

  const mpdFixture = new URL("../../../../../attached_assets/31153-1_1795047996207.mpd", import.meta.url);
  it.skipIf(!existsSync(mpdFixture))(
    "turns the empty source boundary at MPD step 214 into a visible subassembly callout",
    () => {
      const sourceText = readFileSync(mpdFixture, "utf8");
      const parsed = parseLDraw(sourceText);
      const document = createEmptyDocument("31153-1");
      document.imported = {
        version: 1, format: "mpd", sourceName: "31153-1.mpd",
        originalBytes: Array.from(encode(sourceText)), sourceText, ...parsed,
        resources: {}, legalDocuments: [],
      };
      const plan = sourceInstructionPlan(document.imported);
      const step = plan.steps[213];
      expect(step.partIds).toEqual([]);
      expect(step.callouts).toHaveLength(1);
      expect(step.callouts?.[0].title).toBe("window");
      expect(step.callouts?.[0].occurrence).toEqual([15, 287, 163, 30]);
      const prefix = step.callouts![0].occurrence;
      const subassemblyIds = document.imported.instances.filter(part =>
        prefix.every((segment, index) => part.sourceOccurrence?.[index] === segment),
      ).map(part => part.id);
      expect(subassemblyIds.length).toBeGreaterThan(0);
      expect(instructionCalloutPartIds(document, step.callouts![0])).toEqual(subassemblyIds);
      expect(instructionHighlightIds(document, step)).toEqual(new Set(subassemblyIds));
    },
  );

  it("reconciles deleted and added parts without duplicating quantities", () => {
    const doc = fixture(), first = doc.imported!.instances[0].id;
    doc.imported!.instances = doc.imported!.instances.slice(1);
    doc.bricks.push({ id: "new", type: "brick-1x2", color: "#ff0000", x: 0, y: 0, z: 0, rotation: 0 });
    const plan = effectiveInstructions(doc);
    expect(plan.steps.flatMap(step => step.partIds)).not.toContain(first);
    expect(plan.steps.at(-1)!.partIds).toContain("new");
    expect(normalizeDocument({ ...doc, instructions: plan }).instructions).toEqual(plan);
  });

  it("preserves plan IDs across JSON instance-ID remapping", () => {
    const doc = fixture();
    doc.instructions!.steps[0].title = "Boden & Räder";
    const restored = importInternal(exportInternal(doc));
    expect(restored.instructions!.steps[0].title).toBe("Boden & Räder");
    expect(new Set(restored.instructions!.steps.flatMap(step => step.partIds))).toEqual(new Set(restored.imported!.instances.map(part => part.id)));
    expect(restored.imported!.instances[0].id).not.toBe(doc.imported!.instances[0].id);
  });

  it("rejects duplicate part assignments and invalid JSON plans", () => {
    const doc = fixture(), plan = structuredClone(doc.instructions!);
    plan.steps[1].partIds.push(plan.steps[0].partIds[0]);
    expect(() => updateInstructions(doc, plan)).toThrow(/nur einem/);
    expect(() => instructionPlanSchema.parse({ ...plan, steps: [] })).toThrow();
  });

  it("retains the exact untouched IO and unknown payloads in edited IO", () => {
    const doc = fixture();
    expect(exportIO(doc)).toEqual(new Uint8Array(doc.imported!.originalBytes));
    const plan = structuredClone(doc.instructions!);
    plan.steps.reverse(); plan.steps[0].title = "Zuerst die Räder"; plan.steps[0].notes = "Vorsichtig zusammenstecken.";
    const edited = updateInstructions(doc, plan), entries = readZip(exportIO(edited));
    expect(entries["unknown/custom.dat"]).toEqual(new Uint8Array([17, 0, 255]));
    expect(entries["modelv2.ldr"]).toBeUndefined();
    expect(decode(entries["BrickBuilder/original/modelv2.ldr"])).toBe("original Studio variant");
    expect(JSON.parse(decode(entries[".info"]))).toEqual({ parts: 999 });
    const text = decode(entries["model.ldr"]), imported = parseLDraw(text);
    const next = sourceInstructionPlan({ ...doc.imported!, ...imported, sourceText: text });
    expect(next.steps.map(step => step.title)).toEqual(plan.steps.map(step => step.title));
    expect(next.steps[0].notes).toBe("Vorsichtig zusammenstecken.");
    expect(imported.instances.map(part => part.reference)).toEqual(["3003.dat", "3004.dat"]);
    expect(imported.instances).toHaveLength(2);
    expect(decode(exportMPD(edited))).toBe(text);
  });

  it("reads and writes supported Studio instruction XML without executing declarations", () => {
    const doc = fixture(), plan = doc.instructions!;
    plan.steps[0].rotation = [0, 90, -45]; plan.steps[0].title = 'Boden < & "Räder"';
    const restored = readStudioInstructions(writeStudioInstructions(plan), { ...plan, steps: plan.steps.map(step => ({ ...step, rotation: undefined, title: "" })) });
    expect(restored.source).toBe("studio");
    expect(restored.steps[0].rotation![1]).toBeCloseTo(90);
    expect(restored.steps[0].title).toBe(plan.steps[0].title);
    expect(() => readStudioInstructions('<!DOCTYPE Instruction><Instruction/>', plan)).toThrow();
    expect(() => readStudioInstructions("<Bad/>", plan)).toThrow();
  });

  it("preserves repeated touch turns at pitch limits through instruction export and restore", () => {
    const doc = fixture(), plan = doc.instructions!;
    let rotation: [number, number, number] | undefined;
    let expectedView: PerspectiveCamera | undefined;
    const pose = (theta: number, phi: number, pivot?: [number, number, number]) => {
      const view = new PerspectiveCamera(), target = new Vector3();
      view.position.set(Math.sin(phi) * Math.sin(theta), Math.cos(phi), Math.sin(phi) * Math.cos(theta));
      view.lookAt(target);
      applyInstructionCameraRotation(view, target, pivot);
      return view;
    };
    for (let turn = 0; turn < 160; turn++) {
      const theta = DEFAULT_INSTRUCTION_THETA + 0.08;
      const phi = turn % 2 === 0 ? 0.25 : 1.42;
      expectedView = pose(theta, phi, rotation);
      rotation = instructionRotationFromCameraPose(theta, phi, rotation);
    }
    plan.steps[0] = { ...plan.steps[0], rotation };

    const blankPlan = {
      ...plan,
      steps: plan.steps.map(step => ({ ...step, rotation: undefined })),
    };
    const restored = readStudioInstructions(writeStudioInstructions(plan), blankPlan);
    const recoveredRotation = restored.steps[0].rotation;
    const recoveredView = pose(DEFAULT_INSTRUCTION_THETA, DEFAULT_INSTRUCTION_PHI, recoveredRotation);

    expect(rotation).toBeDefined();
    expect(rotation!.every(angle => angle >= -180 && angle <= 180)).toBe(true);
    expect(recoveredRotation).toBeDefined();
    expect(recoveredRotation!.every(angle => angle >= -180 && angle <= 180)).toBe(true);
    expect(recoveredView.quaternion.angleTo(expectedView!.quaternion)).toBeLessThan(0.00001);
  });

  it("includes newly built parts in the final exported step", () => {
    const doc = fixture();
    doc.bricks.push({ id: "added", type: "brick-1x2", color: "#123456", x: 0, y: 0, z: 0, rotation: 0 });
    const parsed = parseLDraw(decode(readZip(exportIO(doc))["model.ldr"]));
    const plan = sourceInstructionPlan({ ...doc.imported!, ...parsed });
    expect(parsed.instances).toHaveLength(3);
    expect(plan.steps.map(step => step.partIds.length)).toEqual([1, 2]);
  });

  it("retains inline surfaces when rewriting instruction steps", () => {
    const doc = fixture(`${line()}\n3 4 0 0 0 20 0 0 0 20 0\n`);
    const edited = updateInstructions(doc, doc.instructions!);
    const text = decode(readZip(exportIO(edited))["model.ldr"]);
    expect(text).toContain("3 4 0 0 0 20 0 0 0 20 0");
    expect(parseLDraw(text).instances).toHaveLength(1);
    expect(doc.imported!.originalBytes.length).toBeGreaterThan(0);
  });

  it("exports a real paginated PDF and disposes the image renderer", async () => {
    const doc = fixture(), dispose = vi.fn();
    const png = `data:image/png;base64,${readFileSync(new URL("../../../public/icons/brickbuilder-512.png", import.meta.url)).toString("base64")}`;
    const counts: number[] = [];
    const image = vi.fn((visible: Set<string>) => { counts.push(visible.size); return png; }), progress = vi.fn();
    const bytes = await exportInstructionPDF(doc, doc.instructions!, { onProgress: progress }, async () => ({ image, dispose }));
    expect(decode(bytes.slice(0, 8))).toContain("%PDF-1.");
    expect(decode(bytes)).toContain("/Count 2");
    expect(image).toHaveBeenCalledTimes(2);
    expect(counts).toEqual([1, 2]);
    expect(dispose).toHaveBeenCalledOnce();
    expect(progress).toHaveBeenLastCalledWith(2, 2);
  });

  it("renders the final repeated touch rotation without changing PDF zoom or target", async () => {
    const doc = fixture();
    const camera = {
      theta: DEFAULT_INSTRUCTION_THETA, phi: DEFAULT_INSTRUCTION_PHI,
      distance: 12.5, target: [1, 2, 3] as [number, number, number],
      referenceDistance: 17, referenceTarget: [0, 0, 0] as [number, number, number],
    };
    let rotation: [number, number, number] | undefined;
    let finalTheta = DEFAULT_INSTRUCTION_THETA, finalPhi = DEFAULT_INSTRUCTION_PHI;
    let expectedView: PerspectiveCamera | undefined;
    const pose = (theta: number, phi: number, pivot?: [number, number, number]) => {
      const view = new PerspectiveCamera(), target = new Vector3();
      view.position.set(Math.sin(phi) * Math.sin(theta), Math.cos(phi), Math.sin(phi) * Math.cos(theta));
      view.lookAt(target);
      applyInstructionCameraRotation(view, target, pivot);
      return view;
    };
    for (let gesture = 0; gesture < 160; gesture++) {
      finalTheta = DEFAULT_INSTRUCTION_THETA + 0.08;
      finalPhi = gesture % 2 === 0 ? 0.25 : 1.42;
      expectedView = pose(finalTheta, finalPhi, rotation);
      rotation = instructionRotationFromCameraPose(finalTheta, finalPhi, rotation);
    }
    doc.instructions!.steps[0] = {
      ...doc.instructions!.steps[0], rotation, camera: structuredClone(camera),
    };
    const renderedSteps: typeof doc.instructions!.steps = [];
    const png = `data:image/png;base64,${readFileSync(new URL("../../../public/icons/brickbuilder-512.png", import.meta.url)).toString("base64")}`;
    await exportInstructionPDF(doc, doc.instructions!, {}, async () => ({
      image: (_visible, step) => { renderedSteps.push(structuredClone(step)); return png; },
      dispose: vi.fn(),
    }));

    const renderedStep = renderedSteps[0];
    expect(renderedStep?.rotation).toEqual(rotation);
    expect(renderedStep?.camera).toEqual(camera);
    const renderedView = pose(DEFAULT_INSTRUCTION_THETA, DEFAULT_INSTRUCTION_PHI, renderedStep?.rotation);
    expect(renderedView.quaternion.angleTo(expectedView!.quaternion)).toBeLessThan(0.00001);

    const pdfCamera = new OrthographicCamera(-5, 5, 4, -4, 0.01, 1000);
    applyPdfStepCamera(pdfCamera, 5, renderedStep?.camera);
    expect(pdfCamera.zoom).toBeCloseTo(camera.referenceDistance / camera.distance);
    const target = new Vector3(...camera.target)
      .sub(new Vector3(...camera.referenceTarget))
      .multiplyScalar((5 * 4) / camera.referenceDistance);
    const towardTarget = target.clone().sub(pdfCamera.position).normalize();
    expect(pdfCamera.position.distanceTo(target)).toBeCloseTo(5 * 4);
    expect(pdfCamera.getWorldDirection(new Vector3()).dot(towardTarget)).toBeCloseTo(1);
  });

  it("cancels PDF generation without saving partial output and releases rendering resources", async () => {
    const doc = fixture(), controller = new AbortController(), dispose = vi.fn();
    await expect(exportInstructionPDF(doc, doc.instructions!, { signal: controller.signal }, async () => ({
      image: () => { controller.abort(); throw new DOMException("Aborted", "AbortError"); }, dispose,
    }))).rejects.toThrow();
    expect(dispose).toHaveBeenCalledOnce();
  });

  it("renders the complete visible source triangle in the software PDF fallback", async () => {
    const doc = fixture(), part = doc.imported!.instances[0];
    part.part.status = "resolved";
    doc.imported!.resources["parts/3004.dat"] = {
      path: "parts/3004.dat", sourceUrl: "https://example.invalid/synthetic", author: "Test", license: "CC0-1.0",
      content: "0 Synthetic PDF test triangle\n3 16 0 0 0 20 0 0 0 20 0\n",
    };
    const fill = vi.fn(), context = {
      fillStyle: "", globalAlpha: 1, fillRect: vi.fn(), beginPath: vi.fn(),
      moveTo: vi.fn(), lineTo: vi.fn(), closePath: vi.fn(), fill,
    };
    const canvas = { width: 0, height: 0, getContext: () => context, toDataURL: () => "data:image/jpeg;base64,test" };
    vi.stubGlobal("document", { createElement: () => canvas });
    try {
      const renderer = await createSoftwareInstructionRenderer(doc);
      renderer.image(new Set([part.id]), doc.instructions!.steps[0]);
      expect(fill).toHaveBeenCalledOnce();
      fill.mockClear();
      renderer.image(new Set(), doc.instructions!.steps[0]);
      expect(fill).not.toHaveBeenCalled();
      renderer.dispose(); expect(canvas.width).toBe(1);
    } finally { vi.unstubAllGlobals(); }
  });
});

for (const filename of ["Schild_(1)_1793518004611.io", "ford_mxCopy_Copy-1_1793477649199.io"]) {
  const path = new URL(`../../../../../attached_assets/${filename}`, import.meta.url);
  it.skipIf(!existsSync(path))(`verifies step and archive preservation against private Studio file ${filename}`, () => {
    const bytes = new Uint8Array(readFileSync(path)), entries = readZip(bytes, { names: ["model.ldr", "model.ins"], studioEncryption: true });
    const source = decode(entries["model.ldr"]), doc = fixture(source);
    doc.imported!.originalBytes = Array.from(bytes);
    const plan = readStudioInstructions(decode(entries["model.ins"]), doc.instructions!);
    expect(plan.steps.length).toBeGreaterThan(1);
    expect(new Set(plan.steps.flatMap(step => step.partIds)).size).toBe(doc.imported!.instances.length);
    doc.instructions = plan;
    expect(exportIO(doc)).toEqual(bytes);
    const edited = updateInstructions(doc, { ...plan, steps: plan.steps.map((step, index) => index ? step : { ...step, title: "Geprüfter Testschritt" }) });
    const regenerated = readZip(exportIO(edited));
    expect(regenerated["BrickBuilder/original/model.ins"]).toEqual(entries["model.ins"]);
    const next = parseLDraw(decode(regenerated["model.ldr"]));
    expect(next.instances).toHaveLength(doc.imported!.instances.length);
  });
}
