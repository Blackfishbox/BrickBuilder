import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createEmptyDocument } from "../editor/model";
import { parseLDraw } from "../formats/ldraw/parser";
import { readZip, writeZip } from "../formats/zip";
import { exportIO } from "../formats/io/export";
import { exportMPD } from "../formats/mpd/export";
import { exportInternal, importInternal } from "../formats/internal/adapter";
import { sourceInstructionPlan, updateInstructions } from "./model";
import { readStudioInstructions } from "./studio";
import { applyStudioLayout, editStudioLayout, inspectStudioLayout, studioNodes } from "./studio-layout";

const encode = (text: string) => new TextEncoder().encode(text);
const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
// Synthetic markup follows observed field names without including private data.
const xml = `<?xml version="1.0"?>
<Instruction vendor="keep &amp; retain"><!-- <Page IsLocked="False"/> -->
<GlobalSetting><PageSetup><PaperType>A4</PaperType></PageSetup><GlobalStyle>
<CallOut><Colors IsUseBgColor="True" BgColor="1:1:1:1" BorderThickness="2"/>
<ArrowStyle Style="TriangleEmpty" Thickness="2" Color="0:0:0:1"/></CallOut>
</GlobalStyle></GlobalSetting>
<Pages><Page template='CustomExample' IsLocked = 'False'>
<Slot><Step SerializedIndex="0" RectOffset="0 0 0 0"><Unknown><![CDATA[<preserve "all">]]></Unknown></Step>
<Image rect="1 2 20 30" rotation="0" opacity="1" fliped_H="False" fliped_V="False" imagePath="ImageResource/rotation.png"/>
<Unknown attributes="unaltered &apos;quote&apos;"><Nested/></Unknown></Slot></Page>
<Page template="OneByOne" IsLocked="False"><Slot><Step SerializedIndex="1" RectOffset="0 0 0 0"/></Slot></Page></Pages>
<ContentItems><Vendor thing="1"/></ContentItems><CustomLayouts><VendorLayout/></CustomLayouts></Instruction>`;
const source = "1 4 0 0 0 1 0 0 0 1 0 0 0 1 3004.dat\n0 STEP\n1 4 40 0 0 1 0 0 0 1 0 0 0 1 3003.dat\n0 STEP\n";
function fixture(markup = xml) {
  const doc = createEmptyDocument("Layout");
  doc.imported = {
    version: 1, format: "io", sourceName: "layout.io",
    sourceText: source, ...parseLDraw(source), resources: {}, legalDocuments: [],
    originalBytes: Array.from(writeZip({
      "model.ldr": encode(source), "model.ins": encode(markup),
      "ImageResource/rotation.png": new Uint8Array([17, 0, 255]),
      "modelv2.ldr": encode("native variant"), "model.lxfml": encode("<Native/>"),
      "vendor/blob": new Uint8Array([0, 255, 1]),
    })),
  };
  doc.instructions = readStudioInstructions(markup, sourceInstructionPlan(doc.imported));
  return doc;
}

describe("source-preserving Studio layout edits", () => {
  it("finds pages, native step references, images and global callout styles", () => {
    const layout = fixture().instructions!.studioLayout!;
    expect(applyStudioLayout(layout)).toBe(xml);
    const view = inspectStudioLayout(layout);
    expect(view.pages.map(page => page.steps)).toEqual([[0], [1]]);
    expect(view.pages[0].template).toBe("CustomExample");
    expect(view.pages[0].items.find(item => item.imagePath)?.imagePath).toBe("ImageResource/rotation.png");
    expect(view.calloutStyles.map(item => item.label)).toEqual(["Colors", "ArrowStyle"]);
  });

  it("patches only requested attributes, keeping comments, CDATA, whitespace and unknown content exact", () => {
    const original = fixture().instructions!.studioLayout!;
    const view = inspectStudioLayout(original), page = view.pages[0], image = page.items.find(item => item.imagePath)!;
    let edited = editStudioLayout(original, image.nodeId, "rotation", "90");
    edited = editStudioLayout(edited, page.nodeId, "IsLocked", "True");
    edited = editStudioLayout(edited, view.calloutStyles[1].nodeId, "Thickness", "3");
    expect(applyStudioLayout(edited)).toBe(xml.replace('rotation="0"', 'rotation="90"').replace("IsLocked = 'False'", "IsLocked = 'True'").replace('Thickness="2" Color', 'Thickness="3" Color'));
    edited = editStudioLayout(edited, page.nodeId, "IsLocked", "False");
    expect(edited.edits).toHaveLength(2);
    expect(original.edits).toEqual([]);
  });

  it("rejects malformed XML, unrecognized attributes, invalid numeric and oversized layouts", () => {
    const layout = fixture().instructions!.studioLayout!, image = inspectStudioLayout(layout).pages[0].items.find(item => item.imagePath)!;
    for (const [attribute, value] of [["opacity", "2"], ["rotation", "NaN"], ["rotation", "0x10"], ["rect", "0 0 -1 3"], ["imagePath", "https://example.invalid/remote.png"], ["fliped_H", "true"]]) {
      expect(() => editStudioLayout(layout, image.nodeId, attribute, value)).toThrow();
    }
    expect(() => applyStudioLayout({ ...layout, edits: [{ nodeId: 99999, attribute: "opacity", value: "1" }] })).toThrow();
    expect(() => studioNodes("<!DOCTYPE Instruction><Instruction/>")).toThrow();
    expect(() => studioNodes("<Instruction><Broken></Instruction>")).toThrow();
    expect(() => studioNodes(" ".repeat(8 * 1024 * 1024 + 1))).toThrow();
  });

  it("rejects a near-limit malformed stop-node payload within a bounded process", () => {
    const worker = fileURLToPath(new URL("../malformed-xml-import-worker.ts", import.meta.url));
    const packageRoot = fileURLToPath(new URL("../../../", import.meta.url));
    const tsx = fileURLToPath(new URL("../../../node_modules/.bin/tsx", import.meta.url));
    const result = spawnSync(tsx, [worker, "studio"], {
      cwd: packageRoot, timeout: 5000, maxBuffer: 16 * 1024,
    });
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr.toString() || result.stdout.toString()).toBe(0);
  }, 15000);

  it("exports layout-only changes without rewriting models, source layout or image resources", () => {
    const doc = fixture(), before = readZip(new Uint8Array(doc.imported!.originalBytes));
    const layout = doc.instructions!.studioLayout!, image = inspectStudioLayout(layout).pages[0].items.find(item => item.imagePath)!;
    const next = updateInstructions(doc, { ...doc.instructions!, studioLayout: editStudioLayout(layout, image.nodeId, "rect", "4 5 25 35") });
    const after = readZip(exportIO(next));
    for (const [name, bytes] of Object.entries(before)) if (name !== "model.ins") expect(after[name]).toEqual(bytes);
    expect(after["BrickBuilder/original/model.ins"]).toEqual(before["model.ins"]);
    expect(decode(after["model.ins"])).toBe(xml.replace('rect="1 2 20 30"', 'rect="4 5 25 35"'));
    expect(decode(exportMPD(next))).toBe(source);
    const restored = readStudioInstructions(decode(after["model.ins"]), sourceInstructionPlan(doc.imported!));
    expect(inspectStudioLayout(restored.studioLayout!).pages[0].items.find(item => item.imagePath)!.attributes.rect).toBe("4 5 25 35");
  });

  it("keeps patches through JSON remapping and refuses mixed changes instead of discarding layouts", () => {
    const doc = fixture(), layout = doc.instructions!.studioLayout!, page = inspectStudioLayout(layout).pages[0];
    doc.instructions = { ...doc.instructions!, studioLayout: editStudioLayout(layout, page.nodeId, "IsLocked", "True"), edited: true };
    const restored = importInternal(exportInternal(doc));
    expect(restored.instructions!.studioLayout).toEqual(doc.instructions.studioLayout);
    expect(decode(readZip(exportIO(restored))["model.ins"])).toContain("IsLocked = 'True'");
    restored.instructions!.steps.reverse();
    expect(() => exportIO(restored)).toThrow(/kombiniert/);
    const moved = structuredClone(doc); moved.imported!.edited = true;
    expect(() => exportIO(moved)).toThrow(/kombiniert/);
    const tampered = structuredClone(doc);
    tampered.instructions!.studioLayout!.sourceXml = xml.replace("keep", "changed");
    expect(() => exportIO(tampered)).toThrow(/Originalarchiv/);
  });

  it("does not guess rotation mapping when native indices are duplicated or missing", () => {
    const duplicate = fixture(xml.replace('SerializedIndex="1"', 'SerializedIndex="0"'));
    expect(duplicate.instructions!.warnings).toHaveLength(1);
    const missing = fixture(xml.replace('SerializedIndex="1"', 'SerializedIndex=""'));
    expect(missing.instructions!.warnings).toHaveLength(1);
  });
});

// Local-only source audit; fixture data and generated IO never enter public assets.
for (const filename of ["0_Schild_(1)_1794979647532.io", "0_ford_mxCopy_Copy-1_1794979736457.io"]) {
  const path = new URL(`../../../../../attached_assets/${filename}`, import.meta.url);
  it.skipIf(!existsSync(path))("preserves all entries while editing an available private Studio layout", () => {
    const original = readZip(new Uint8Array(readFileSync(path)), { studioEncryption: true });
    const doc = fixture(decode(original["model.ins"]));
    const modelSource = decode(original["model.ldr"]);
    doc.imported = { ...doc.imported!, ...parseLDraw(modelSource), sourceText: modelSource, originalBytes: Array.from(readFileSync(path)) };
    doc.instructions = readStudioInstructions(decode(original["model.ins"]), sourceInstructionPlan(doc.imported));
    const layout = doc.instructions.studioLayout!, view = inspectStudioLayout(layout), page = view.pages[0];
    doc.instructions = updateInstructions(doc, { ...doc.instructions, studioLayout: editStudioLayout(layout, page.nodeId, "IsLocked", page.items[0].attributes.IsLocked === "True" ? "False" : "True") }).instructions;
    const exported = readZip(exportIO(doc));
    for (const [name, bytes] of Object.entries(original)) if (name !== "model.ins") expect(exported[name]).toEqual(bytes);
    expect(exported["BrickBuilder/original/model.ins"]).toEqual(original["model.ins"]);
    expect(parseLDraw(decode(exported["model.ldr"])).instances).toHaveLength(doc.imported.instances.length);
  });
}
