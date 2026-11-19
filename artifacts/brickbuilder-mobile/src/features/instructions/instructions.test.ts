import { existsSync, readFileSync } from "node:fs";
import { gunzipSync, unzlibSync, zlibSync } from "fflate";
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
import { PART_PACKAGES, validatePayload } from "../parts/library";
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

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const name = encode(type), body = new Uint8Array(name.length + data.length);
  body.set(name); body.set(data, name.length);
  let checksum = 0xffffffff;
  for (const byte of body) {
    checksum ^= byte;
    for (let bit = 0; bit < 8; bit++) checksum = (checksum >>> 1) ^ (checksum & 1 ? 0xedb88320 : 0);
  }
  const chunk = new Uint8Array(body.length + 8), view = new DataView(chunk.buffer);
  view.setUint32(0, data.length); chunk.set(body, 4); view.setUint32(body.length + 4, (checksum ^ 0xffffffff) >>> 0);
  return chunk;
}

function rasterCanvas(width: number, height: number) {
  const pixels = new Uint8Array(width * height * 4), path: [number, number][] = [], triangleAlphas: number[] = [];
  let fillStyle = "#000000", globalAlpha = 1, filledTriangles = 0;
  const color = () => {
    const rgb = fillStyle.match(/rgb\(\s*(\d+),\s*(\d+),\s*(\d+)\s*\)/);
    const hex = fillStyle.match(/^#([0-9a-f]{6})$/i);
    return rgb ? [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])] :
      hex ? [0, 2, 4].map(offset => parseInt(hex[1].slice(offset, offset + 2), 16)) : [0, 0, 0];
  };
  const paint = (x: number, y: number, rgba: number[]) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const offset = (y * width + x) * 4;
    for (let channel = 0; channel < 3; channel++) {
      pixels[offset + channel] = Math.round(rgba[channel] * globalAlpha + pixels[offset + channel] * (1 - globalAlpha));
    }
    pixels[offset + 3] = 255;
  };
  const context = {
    get fillStyle() { return fillStyle; }, set fillStyle(value: string) { fillStyle = value; },
    get globalAlpha() { return globalAlpha; }, set globalAlpha(value: number) { globalAlpha = value; },
    strokeStyle: "", lineWidth: 0,
    save() {}, restore() {}, stroke() {},
    fillRect(x: number, y: number, w: number, h: number) {
      const rgba = color();
      for (let py = Math.max(0, Math.floor(y)); py < Math.min(height, Math.ceil(y + h)); py++) {
        for (let px = Math.max(0, Math.floor(x)); px < Math.min(width, Math.ceil(x + w)); px++) paint(px, py, rgba);
      }
    },
    beginPath() { path.length = 0; },
    moveTo(x: number, y: number) { path.push([x, y]); },
    lineTo(x: number, y: number) { path.push([x, y]); },
    closePath() {},
    fill() {
      if (path.length < 3) return;
      filledTriangles++;
      const [a, b, c] = path, area = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1]);
      if (!area) return;
      triangleAlphas.push(globalAlpha);
      const rgba = color();
      const minX = Math.max(0, Math.floor(Math.min(a[0], b[0], c[0])));
      const maxX = Math.min(width - 1, Math.ceil(Math.max(a[0], b[0], c[0])));
      const minY = Math.max(0, Math.floor(Math.min(a[1], b[1], c[1])));
      const maxY = Math.min(height - 1, Math.ceil(Math.max(a[1], b[1], c[1])));
      for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
        const px = x + 0.5, py = y + 0.5;
        const u = ((b[1] - c[1]) * (px - c[0]) + (c[0] - b[0]) * (py - c[1])) / area;
        const v = ((c[1] - a[1]) * (px - c[0]) + (a[0] - c[0]) * (py - c[1])) / area;
        if (u >= 0 && v >= 0 && u + v <= 1) paint(x, y, rgba);
      }
    },
  };
  const canvas = {
    width, height, getContext: () => context,
    toDataURL() {
      const scanlines = new Uint8Array(height * (width * 4 + 1));
      for (let y = 0; y < height; y++) scanlines.set(pixels.subarray(y * width * 4, (y + 1) * width * 4), y * (width * 4 + 1) + 1);
      const header = new Uint8Array(13), view = new DataView(header.buffer);
      view.setUint32(0, width); view.setUint32(4, height); header.set([8, 6, 0, 0, 0], 8);
      const signature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
      const png = new Uint8Array(signature.length + pngChunk("IHDR", header).length + pngChunk("IDAT", zlibSync(scanlines)).length + pngChunk("IEND", new Uint8Array()).length);
      let offset = 0;
      for (const chunk of [signature, pngChunk("IHDR", header), pngChunk("IDAT", zlibSync(scanlines)), pngChunk("IEND", new Uint8Array())]) {
        png.set(chunk, offset); offset += chunk.length;
      }
      return `data:image/png;base64,${Buffer.from(png).toString("base64")}`;
    },
  };
  return { canvas, get filledTriangles() { return filledTriangles; }, pixels, triangleAlphas };
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

  it("restores camera angles from the legacy Studio attribute", () => {
    const plan = fixture().instructions!;
    const expectedRotation: [number, number, number] = [23, -47, 68];
    const modernXml = writeStudioInstructions({
      ...plan,
      steps: plan.steps.map((step, index) => index === 0 ? { ...step, rotation: expectedRotation } : step),
    });
    const legacyXml = modernXml.replaceAll(' modelAngle="', ' DefaultCameraControlInfo_modelAngle="');
    expect(legacyXml).toContain(' DefaultCameraControlInfo_modelAngle="');
    expect(legacyXml).not.toContain(' modelAngle="');

    const blankPlan = {
      ...plan,
      steps: plan.steps.map(step => ({ ...step, rotation: undefined })),
    };
    const restored = readStudioInstructions(legacyXml, blankPlan);
    const recoveredRotation = restored.steps[0].rotation;
    const pose = (rotation?: [number, number, number]) => {
      const view = new PerspectiveCamera(), target = new Vector3();
      view.position.set(
        Math.sin(DEFAULT_INSTRUCTION_PHI) * Math.sin(DEFAULT_INSTRUCTION_THETA),
        Math.cos(DEFAULT_INSTRUCTION_PHI),
        Math.sin(DEFAULT_INSTRUCTION_PHI) * Math.cos(DEFAULT_INSTRUCTION_THETA),
      );
      view.lookAt(target);
      applyInstructionCameraRotation(view, target, rotation);
      return view;
    };

    expect(recoveredRotation).toBeDefined();
    expect(pose(recoveredRotation).quaternion.angleTo(pose(expectedRotation).quaternion)).toBeLessThan(0.00001);
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

  it("keeps step labels, every part and callout, and long notes across PDF continuation pages", async () => {
    const source = Array.from({ length: 50 }, (_, index) =>
      `1 4 ${index * 40} 0 0 1 0 0 0 1 0 0 0 1 test-part-${String(index).padStart(2, "0")}.dat`,
    ).join("\n");
    const doc = fixture(source), step = doc.instructions!.steps[0];
    const maxStepTitle = ["MaxTitle", ...Array.from({ length: 15 }, (_, index) => `Section${String(index + 1).padStart(2, "0")}`), "X"].join(" ");
    expect(maxStepTitle).toHaveLength(160);
    step.title = maxStepTitle;
    step.notes = Array.from({ length: 37 }, (_, index) =>
      `NOTE-CONTENT-${String(index).padStart(3, "0")} continues beyond the diagram and must remain readable.`,
    ).join(" ");
    const longCalloutName = "Callout 03 North Tower Reinforced Upper-Floor Corner Window Assembly";
    step.callouts = Array.from({ length: 16 }, (_, index) => ({
      id: `callout-${index}`,
      title: index === 3 ? longCalloutName : `Callout ${String(index).padStart(2, "0")}`,
      occurrence: [index],
    }));
    const png = `data:image/png;base64,${readFileSync(new URL("../../../public/icons/brickbuilder-512.png", import.meta.url)).toString("base64")}`;
    const bytes = await exportInstructionPDF(doc, doc.instructions!, {}, async () => ({
      image: () => png, dispose: vi.fn(),
    }), async () => png, async () => png);
    const output = Buffer.from(bytes).toString("latin1");
    const objects = new Map([...output.matchAll(/(\d+)\s+0\s+obj([\s\S]*?)endobj/g)]
      .map(match => [Number(match[1]), match[2]]));
    const pageContentRefs = [...objects.values()]
      .filter(body => /\/Type\s*\/Page\b/.test(body))
      .map(body => body.match(/\/Contents\s+(\d+)\s+0\s+R/)?.[1])
      .filter((reference): reference is string => !!reference);
    const pageTexts = pageContentRefs
      .map(reference => {
        const body = objects.get(Number(reference)) ?? "";
        const stream = body.match(/<<([\s\S]*?)>>\s*stream\r?\n([\s\S]*?)\r?\nendstream/);
        if (!stream) return "";
        const bytes = Buffer.from(stream[2], "latin1");
        return Buffer.from(stream[1].includes("/FlateDecode") ? unzlibSync(bytes) : bytes).toString("latin1");
      });
    const textY = (pageIndex: number, marker: string) => {
      const block = pageTexts[pageIndex].match(/BT[\s\S]*?ET/g)?.find(candidate => candidate.includes(marker));
      expect(block, `missing visible PDF text: ${marker}`).toBeDefined();
      return Number(block!.match(/[\d.]+\s+([\d.]+)\s+Td/)?.[1]);
    };
    const stepTitleBottomY = (pageIndex: number) => {
      const block = pageTexts[pageIndex].match(/BT[\s\S]*?ET/g)?.find(candidate =>
        candidate.includes("(1. MaxTitle") && candidate.includes("Section15 X"),
      );
      expect(block, "missing the complete step title from a PDF page").toBeDefined();
      const startY = Number(block!.match(/[\d.]+\s+([\d.]+)\s+Td/)?.[1]);
      const lineHeight = Number(block!.match(/([\d.]+)\s+TL/)?.[1]);
      const lineCount = block!.match(/\) Tj/g)?.length ?? 1;
      return startY - lineHeight * (lineCount - 1);
    };

    expect(decode(bytes.slice(0, 8))).toContain("%PDF-1.");
    expect(output).toContain("/Count 6");
    expect(pageTexts).toHaveLength(6);
    for (const pageText of pageTexts) {
      let cursor = 0;
      for (const word of maxStepTitle.split(" ")) {
        const position = pageText.indexOf(word, cursor);
        expect(position, `missing ${word} from a page's complete step title`).toBeGreaterThanOrEqual(cursor);
        cursor = position + word.length;
      }
    }
    const contentMarkers = [
      "Teile und Baugruppen in diesem Schritt",
      "NOTE-CONTENT-036",
      "Callout 03",
      "Callout 15",
      "LDraw test-part-06",
      "LDraw test-part-42",
    ];
    contentMarkers.forEach((marker, pageIndex) => {
      expect(stepTitleBottomY(pageIndex) - textY(pageIndex, marker)).toBeGreaterThan(15);
    });
    expect(pageTexts[0]).toContain("Teile und Baugruppen in diesem Schritt");
    expect(pageTexts[1]).toContain("Hinweise \\(Fortsetzung\\)");
    expect(pageTexts[1]).toContain("NOTE-CONTENT-036");
    expect(pageTexts[2]).toContain("Baugruppen \\(Fortsetzung\\)");
    expect(pageTexts[2]).toContain("Callout 03");
    const longNameWords = longCalloutName.split(" ").slice(2);
    const longNamePositions = longNameWords.map(word => pageTexts[2].indexOf(word));
    expect(longNamePositions.every(position => position >= 0)).toBe(true);
    expect(longNamePositions).toEqual([...longNamePositions].sort((left, right) => left - right));
    expect(pageTexts[2]).toContain("Callout 14");
    expect(pageTexts[3]).toContain("Baugruppen \\(Fortsetzung\\)");
    expect(pageTexts[3]).toContain("Callout 15");
    expect(pageTexts[4]).toContain("Teile \\(Fortsetzung\\)");
    expect(pageTexts[4]).toContain("LDraw test-part-06");
    expect(pageTexts[4]).toContain("LDraw test-part-41");
    expect(pageTexts[5]).toContain("Teile \\(Fortsetzung\\)");
    expect(pageTexts[5]).toContain("LDraw test-part-42");
    expect(pageTexts[5]).toContain("LDraw test-part-49");
    const text = pageTexts.join("\n");
    expect(text).toContain("NOTE-CONTENT-000");
    for (let index = 0; index < 50; index++) {
      expect(text).toContain(`LDraw test-part-${String(index).padStart(2, "0")}`);
    }
    for (let index = 0; index < 16; index++) {
      expect(text).toContain(`Callout ${String(index).padStart(2, "0")}`);
    }
  });

  it("exports resolved official LDraw geometry as a PDF diagram with readable quantities", async () => {
    const manifest = PART_PACKAGES.find(pkg => pkg.id === "ldraw-bricks")!;
    const bytes = readFileSync(new URL(`../../../public/${manifest.url}`, import.meta.url));
    const parsed = JSON.parse(new TextDecoder().decode(
      manifest.compression === "gzip" ? gunzipSync(bytes) : bytes,
    ));
    const packageData = validatePayload(parsed, manifest);
    const doc = fixture(`${line("3004", 0)}\n${line("3004", 40)}\n0 STEP\n${line("3004", 80)}\n`);
    doc.imported!.resources = Object.fromEntries(packageData.files.map(file => [file.path, file]));
    for (const part of doc.imported!.instances) part.part.status = "resolved";
    const partGeometry = createSoftwareInstructionRenderer;
    const canvases: ReturnType<typeof rasterCanvas>[] = [];
    vi.stubGlobal("document", {
      createElement: () => {
        const rendered = rasterCanvas(200, 152);
        canvases.push(rendered);
        return rendered.canvas;
      },
    });
    try {
      const renderPart = async (document: typeof doc, entry: Parameters<typeof import("./parts").instructionPartImage>[1], signal: AbortSignal) => {
        const renderer = await partGeometry(document, signal, { width: 120, height: 91, minRadius: 0.01 });
        try { return renderer.image(new Set([entry.part.id]), { id: "part", title: "", notes: "", partIds: [entry.part.id] }); }
        finally { renderer.dispose(); }
      };
      const pdf = await exportInstructionPDF(doc, doc.instructions!, {}, (document, signal) =>
        createSoftwareInstructionRenderer(document, signal, { width: 200, height: 152 }),
        renderPart,
      );
      const output = Buffer.from(pdf).toString("latin1");
      const objectStreams: string[] = [];
      const streamPattern = /<<([\s\S]*?)>>\s*stream\r?\n([\s\S]*?)\r?\nendstream/g;
      for (const match of output.matchAll(streamPattern)) {
        if (match[1].includes("/FlateDecode")) {
          objectStreams.push(Buffer.from(unzlibSync(Buffer.from(match[2], "latin1"))).toString("latin1"));
        }
      }
      const text = objectStreams.join("\n");
      expect(doc.imported!.resources["parts/3004.dat"].content).toContain("0 !LDRAW_ORG Part");
      expect(decode(pdf.slice(0, 8))).toContain("%PDF-1.");
      expect(output).toContain("/Subtype /Image");
      expect(canvases.length).toBeGreaterThanOrEqual(3);
      expect(canvases[0].filledTriangles).toBeGreaterThan(0);
      expect(canvases[0].pixels.some((value, index) => index % 4 !== 3 && value !== 255)).toBe(true);
      expect(text).toContain("2×");
      expect(text).toContain("LDraw 3004");
      expect(text).toContain("2 neue Teile");
      expect(text).toContain("3 Teile bis zu diesem Schritt");
      expect(text).toContain("1 neue Teile");
    } finally { vi.unstubAllGlobals(); }
  });

  it("keeps resolved transparent LDraw parts visible in highlighted PDF steps", async () => {
    const manifest = PART_PACKAGES.find(pkg => pkg.id === "ldraw-default-details")!;
    const bytes = readFileSync(new URL(`../../../public/${manifest.url}`, import.meta.url));
    const parsed = JSON.parse(new TextDecoder().decode(
      manifest.compression === "gzip" ? gunzipSync(bytes) : bytes,
    ));
    const packageData = validatePayload(parsed, manifest);
    const source = "1 43 0 0 0 1 0 0 0 1 0 0 0 1 2494.dat\n0 STEP\n";
    const doc = fixture(source);
    doc.imported!.resources = Object.fromEntries(packageData.files.map(file => [file.path, file]));
    for (const part of doc.imported!.instances) part.part.status = "resolved";
    doc.bricks.push({
      id: "earlier-solid", type: "brick-1x2", color: "#d75b3f",
      x: -3, y: 0, z: 0, rotation: 0,
    });
    const glassId = doc.imported!.instances[0].id;
    doc.instructions = {
      version: 1, edited: false, source: "manual", warnings: [],
      steps: [
        { id: "base", title: "Base", notes: "", partIds: ["earlier-solid"] },
        { id: "transparent-glass", title: "Glass", notes: "", partIds: [glassId] },
      ],
    };
    const canvases: ReturnType<typeof rasterCanvas>[] = [];
    const highlightSets: (ReadonlySet<string> | undefined)[] = [];
    vi.stubGlobal("document", {
      createElement: () => {
        const rendered = rasterCanvas(240, 182);
        canvases.push(rendered);
        return rendered.canvas;
      },
    });
    try {
      const pdf = await exportInstructionPDF(doc, doc.instructions!, { highlight: true }, async (document, signal) => {
        const renderer = await createSoftwareInstructionRenderer(document, signal, { width: 240, height: 182 });
        return {
          image(visible, step, highlightIds) {
            highlightSets.push(highlightIds);
            return renderer.image(visible, step, highlightIds);
          },
          dispose: () => renderer.dispose(),
        };
      },
      );
      const output = Buffer.from(pdf).toString("latin1");
      const glass = packageData.files.find(file => file.path === "parts/2494.dat")!;
      expect(glass.content).toMatch(/^0 !LDRAW_ORG Part(?: UPDATE[^\r\n]*)?$/m);
      expect(glass.content).toContain("0 !LICENSE Licensed under CC BY 4.0 : see CAreadme.txt");
      expect(decode(pdf.slice(0, 8))).toContain("%PDF-1.");
      expect(output).toContain("/Subtype /Image");
      expect(output).toContain("/Count 2");
      expect(canvases.length).toBeGreaterThanOrEqual(2);
      expect(canvases[0].filledTriangles).toBeGreaterThan(0);
      expect(canvases[0].triangleAlphas).toContain(128 / 255);
      expect(canvases[0].pixels.some((value, index) => index % 4 !== 3 && value < 250)).toBe(true);
      expect(highlightSets).toEqual([undefined, new Set([glassId])]);
    } finally { vi.unstubAllGlobals(); }
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

  it("cancels fallback PDF rendering during geometry collection and releases its canvas", async () => {
    const source = Array.from({ length: 13 }, (_, index) => line("3004", index * 40)).join("\n");
    const doc = fixture(source), controller = new AbortController();
    for (const part of doc.imported!.instances) part.part.status = "resolved";
    doc.imported!.resources["parts/3004.dat"] = {
      path: "parts/3004.dat", sourceUrl: "https://example.invalid/synthetic", author: "Test", license: "CC0-1.0",
      content: "0 Synthetic PDF test triangle\n3 16 0 0 0 20 0 0 0 20 0\n",
    };
    const context = {
      fillStyle: "", globalAlpha: 1, fillRect: vi.fn(), beginPath: vi.fn(),
      moveTo: vi.fn(), lineTo: vi.fn(), closePath: vi.fn(), fill: vi.fn(),
    };
    const canvas = { width: 0, height: 0, getContext: () => context, toDataURL: () => "data:image/jpeg;base64,test" };
    let geometryCollected = false;
    vi.stubGlobal("document", { createElement: () => canvas });
    vi.stubGlobal("setTimeout", (callback: () => void) => {
      geometryCollected = true;
      controller.abort();
      queueMicrotask(callback);
      return 0;
    });
    try {
      await expect(exportInstructionPDF(doc, doc.instructions!, { signal: controller.signal }, (document, signal) =>
        createSoftwareInstructionRenderer(document, signal),
      )).rejects.toThrow();
      expect(geometryCollected).toBe(true);
      expect(canvas.width).toBe(1);
      expect(canvas.height).toBe(1);
    } finally { vi.unstubAllGlobals(); }
  });

  it("rejects oversized PDF fallback diagrams clearly and releases the canvas", async () => {
    const doc = fixture("1 4 0 0 0 1 0 0 0 1 0 0 0 1 oversized.dat\n");
    const part = doc.imported!.instances[0];
    part.part.status = "resolved";
    const triangle = "3 16 0 0 0 20 0 0 0 20 0";
    const quad = "4 16 0 0 0 20 0 0 20 20 0 0 20 0";
    doc.imported!.resources["parts/oversized.dat"] = {
      path: "parts/oversized.dat", sourceUrl: "https://example.invalid/oversized", author: "Test", license: "CC0-1.0",
      content: `${Array.from({ length: 60_000 }, () => quad).join("\n")}\n${triangle}`,
    };
    const context = {
      fillStyle: "", globalAlpha: 1, fillRect: vi.fn(), beginPath: vi.fn(),
      moveTo: vi.fn(), lineTo: vi.fn(), closePath: vi.fn(), fill: vi.fn(),
    };
    const canvas = { width: 0, height: 0, getContext: () => context, toDataURL: () => "data:image/jpeg;base64,test" };
    vi.stubGlobal("document", { createElement: () => canvas });
    try {
      await expect(exportInstructionPDF(doc, doc.instructions!, {}, (document, signal) =>
        createSoftwareInstructionRenderer(document, signal),
      )).rejects.toThrow("PDF: WebGL ist nicht verfügbar und dieses Modell ist für die vollständige Software-Abbildung zu groß.");
      expect(canvas.width).toBe(1);
      expect(canvas.height).toBe(1);
    } finally { vi.unstubAllGlobals(); }
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
