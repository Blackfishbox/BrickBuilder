import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createEmptyDocument, type BuilderDocument } from "@/features/editor/model";
import { editImported, recolorImported, rotateImported } from "@/features/editor/ldraw-editing";
import type { Affine, ImportedModel } from "../types";
import { IDENTITY, multiply, parseLDraw, referenceLine } from "../ldraw/parser";
import { exportInternal, importInternal } from "../internal/adapter";
import { exportIO } from "../io/export";
import { readZip, writeZip } from "../zip";
import { exportMPD } from "./export";
import { sourceInstructionPlan, updateInstructions } from "@/features/instructions/model";
import { readStudioInstructions } from "@/features/instructions/studio";

const encode = (text: string) => new TextEncoder().encode(text);
const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
const ref = (name: string, color = "16", x = 0) => `1 ${color} ${x} 0 0 1 0 0 0 1 0 0 0 1 ${name}`;
const source = `0 !UNKNOWN preamble payload
0 FILE main.ldr
0 !UNKNOWN root payload
${ref("assembly.ldr", "4")}
${ref("assembly.ldr", "14", 100)}
${ref("assembly.ldr", "2", 200)}
0 FILE assembly.ldr
0 !UNKNOWN child payload
0 STEP
${ref("inner.ldr")}
${ref("inline.dat", "16", 10)}
0 FILE inner.ldr
${ref("a.dat")}
${ref("b.dat", "0", 20)}
0 FILE inline.dat
0 !LICENSE Synthetic CC0-1.0 fixture
2 24 0 0 0 1 1 1
3 16 0 0 0 10 0 0 0 10 0
4 4 0 0 0 1 0 0 1 1 0 0 1 0
5 24 0 0 0 1 1 1 1 0 0 0 1 0
0 FILE unused.dat
0 !UNKNOWN unreferenced record
3 16 0 0 0 1 0 0 0 1 0
0 NOFILE
`;

function fixture(text = source): BuilderDocument & { imported: ImportedModel } {
  return { ...createEmptyDocument("Export fixture"), imported: {
    version: 1, format: "mpd", sourceName: "fixture.mpd", sourceText: text,
    originalBytes: Array.from(encode(text)), ...parseLDraw(text), resources: {}, legalDocuments: [],
  } };
}

function assertEffective(text: string, document: BuilderDocument) {
  const actual = parseLDraw(text).instances;
  const expected = document.imported!.instances;
  expect(actual).toHaveLength(expected.length + document.bricks.length);
  // Traversal order can change when singular transforms require root lifting.
  const remaining = [...actual];
  for (const instance of expected) {
    const index = remaining.findIndex(i => i.reference === instance.reference && i.colorCode === instance.colorCode &&
      i.matrix.every((n, j) => Math.abs(n - instance.matrix[j]) < 1e-6));
    expect(index, `Missing effective occurrence ${JSON.stringify(instance)}`).toBeGreaterThanOrEqual(0);
    remaining.splice(index, 1);
  }
}

/** Independent traversal of retained inline geometry, not the leaf-instance parser. */
function inlineSurfaces(text: string) {
  const parsed = parseLDraw(text), surfaces: string[] = [];
  function walk(name: string, parent: Affine, color: string) {
    for (const line of parsed.sections[name]) {
      if (/^\s*1\s/.test(line)) {
        const r = referenceLine(line), target = r.reference.toLowerCase();
        if (parsed.sections[target]) walk(target, multiply(parent, r.matrix), r.color === "16" ? color : r.color);
      } else if (/^\s*[2-5]\s/.test(line)) surfaces.push(JSON.stringify([line, parent, color]));
    }
  }
  walk(parsed.root, IDENTITY, "16");
  return surfaces.sort();
}

/** BFC state is scoped to each section; INVERTNEXT also affects leaf references. */
function bfcGeometry(text: string) {
  const parsed = parseLDraw(text), result: string[] = [];
  function walk(name: string, parent: Affine, color: string, inverted: boolean) {
    let next = false, winding = "CCW", clip = true, certified = false;
    for (const line of parsed.sections[name]) {
      if (/^\s*0\s+BFC\s/.test(line)) {
        const tokens = line.trim().split(/\s+/).slice(2);
        if (tokens.includes("INVERTNEXT")) next = true;
        if (tokens.includes("CERTIFY")) certified = true;
        if (tokens.includes("NOCERTIFY")) certified = false;
        if (tokens.includes("CW")) winding = "CW";
        if (tokens.includes("CCW")) winding = "CCW";
        if (tokens.includes("CLIP")) clip = true;
        if (tokens.includes("NOCLIP")) clip = false;
      } else if (/^\s*1\s/.test(line)) {
        const r = referenceLine(line), target = r.reference.toLowerCase();
        if (parsed.sections[target]) walk(target, multiply(parent, r.matrix), r.color === "16" ? color : r.color, inverted !== next);
        else result.push(JSON.stringify(["leaf", target, multiply(parent, r.matrix), inverted !== next]));
        next = false;
      } else if (/^\s*[2-5]\s/.test(line)) {
        result.push(JSON.stringify([line, parent, color, inverted, winding, clip, certified]));
        next = false;
      }
    }
  }
  walk(parsed.root, IDENTITY, "16", false);
  return result.sort();
}

function reverseInstructions(document: BuilderDocument) {
  const plan = sourceInstructionPlan(document.imported!);
  return updateInstructions(document, { ...plan, steps: plan.steps.reverse() });
}

function assertInstructionMembership(text: string, document: BuilderDocument) {
  const parsed = parseLDraw(text);
  const actual = sourceInstructionPlan({ ...document.imported!, ...parsed, sourceText: text });
  const wanted = document.instructions!;
  expect(actual.steps.map(s => [s.title, s.notes, s.rotation])).toEqual(wanted.steps.map(s => [s.title, s.notes, s.rotation]));
  const signature = (i: ImportedModel["instances"][number]) => JSON.stringify([i.reference, i.colorCode, i.matrix.map(n => Math.round(n * 1e6) / 1e6)]);
  const byId = new Map(parsed.instances.map(i => [i.id, signature(i)]));
  const expectedById = new Map(document.imported!.instances.map(i => [i.id, signature(i)]));
  expect(actual.steps.map(s => s.partIds.map(id => byId.get(id)).sort())).toEqual(wanted.steps.map(s => s.partIds.map(id => expectedById.get(id)).sort()));
}

describe("hierarchical instruction exports", () => {
  it("splits repeated submodels by occurrence without duplicating inline geometry or losing BFC", () => {
    const text = source.replace(ref("assembly.ldr", "14", 100), `0 BFC INVERTNEXT\n${ref("assembly.ldr", "14", 100)}`)
      .replace("0 !UNKNOWN child payload", "0 !UNKNOWN child payload\n0 BFC CERTIFY CW\n0 BFC NOCLIP")
      .replace('0 !LICENSE Synthetic CC0-1.0 fixture', '0 !LICENSE Synthetic CC0-1.0 fixture\n0 BFC CERTIFY CCW');
    const original = fixture(text), plan = sourceInstructionPlan(original.imported);
    // Interleave identical leaves from three occurrences across root steps.
    const ids = original.imported.instances.map(i => i.id);
    plan.steps = [
      { id: "one", title: "First", notes: "Opaque & preserved", partIds: [ids[3], ids[0]], rotation: [5, 20, 30] },
      { id: "empty", title: "Empty", notes: "", partIds: [] },
      { id: "two", title: "Last", notes: "", partIds: [ids[1], ids[2], ids[4], ids[5]] },
    ];
    const edited = updateInstructions(original, plan), before = JSON.stringify(edited);
    for (const exported of [decode(exportMPD(edited)), decode(readZip(exportIO(edited))["model.ldr"])]) {
      assertEffective(exported, edited);
      assertInstructionMembership(exported, edited);
      expect(inlineSurfaces(exported)).toEqual(inlineSurfaces(text));
      expect(bfcGeometry(exported)).toEqual(bfcGeometry(text));
      const parsed = parseLDraw(exported);
      expect(parsed.sections["main.ldr"].filter(l => !/^0 NOFILE$/.test(l))).toEqual(original.imported.sections["main.ldr"].filter(l => !/^0 NOFILE$/.test(l)));
      expect(parsed.sections["unused.dat"]).toContain("0 !UNKNOWN unreferenced record");
      // The active model still traverses root → assembly → inner.
      expect(Math.max(...parsed.instances.map(i => i.sourceOccurrence!.length))).toBeGreaterThanOrEqual(3);
    }
    expect(JSON.stringify(edited)).toBe(before);
  });

  it("lifts a changed leaf under a singular transform into its assigned step only", () => {
    const text = `0 FILE main.ldr
0 BFC INVERTNEXT
1 4 10 20 30 0 0 0 0 1 0 0 0 1 sub.ldr
0 FILE sub.ldr
0 BFC CERTIFY CW
3 16 0 0 0 0 10 0 0 0 10
0 BFC INVERTNEXT
${ref("a.dat")}
0 STEP
${ref("b.dat")}`;
    const original = fixture(text);
    const edited = reverseInstructions(editImported(original, original.imported.instances[0].id, i => ({ ...i, matrix: [...IDENTITY] })));
    const exported = decode(exportMPD(edited));
    assertEffective(exported, edited);
    assertInstructionMembership(exported, edited);
    expect(inlineSurfaces(exported)).toEqual(inlineSurfaces(text));
    const activeBfc = bfcGeometry(exported).map(s => JSON.parse(s));
    expect(activeBfc.find(s => s[0] === "leaf" && s[1] === "a.dat").at(-1)).toBe(false);
    expect(activeBfc.find(s => s[0] === "leaf" && s[1] === "b.dat").at(-1)).toBe(true);
  });

  it("keeps geometry-only submodels active even after all their sibling parts are deleted", () => {
    const original = fixture(), deleted = { ...original, imported: { ...original.imported,
      instances: original.imported.instances.slice(-1), edited: true,
    } };
    const edited = reverseInstructions(deleted), exported = decode(exportMPD(edited));
    assertEffective(exported, edited);
    assertInstructionMembership(exported, edited);
    expect(inlineSurfaces(exported)).toEqual(inlineSurfaces(source));
  });

  it("reexports a generated IO after another occurrence-specific instruction edit", () => {
    const original = reverseInstructions(fixture());
    original.imported!.format = "io";
    original.imported!.originalBytes = Array.from(writeZip({ "model.ldr": encode(source), "unknown.bin": new Uint8Array([0, 255]) }));
    const firstArchive = exportIO(original);
    const once = decode(readZip(firstArchive)["model.ldr"]), next = fixture(once);
    next.imported.format = "io";
    next.imported.originalBytes = Array.from(firstArchive);
    const edited = reverseInstructions(next), entries = readZip(exportIO(edited)), twice = decode(entries["model.ldr"]);
    assertEffective(twice, edited);
    assertInstructionMembership(twice, edited);
    expect(inlineSurfaces(twice)).toEqual(inlineSurfaces(source));
    expect(bfcGeometry(twice)).toEqual(bfcGeometry(source));
    expect(entries["BrickBuilder/original/model.ldr"]).toEqual(encode(source));
    expect(entries["unknown.bin"]).toEqual(new Uint8Array([0, 255]));
  });

  it("does not leak a skipped reference's INVERTNEXT into a later step's leaf", () => {
    const text = `0 BFC INVERTNEXT\n${ref("a.dat", "4")}\n0 STEP\n${ref("b.dat", "4")}`;
    const edited = reverseInstructions(fixture(text)), exported = decode(exportMPD(edited));
    assertInstructionMembership(exported, edited);
    expect(bfcGeometry(exported)).toEqual(bfcGeometry(text));
  });

  it("keeps world transforms after reflection, shear, recoloring, deletion and additions", () => {
    const text = `0 FILE main.ldr
1 4 10 20 30 -1 0.5 0 0 2 0 0 0 3 sub.ldr
0 FILE sub.ldr
0 BFC CERTIFY CCW
3 16 0 0 0 10 0 0 0 10 0
${ref("a.dat")}
0 STEP
${ref("b.dat")}
0 STEP
${ref("c.dat")}`;
    const original = fixture(text);
    let edited = editImported(rotateImported(original, original.imported.instances[0].id),
      original.imported.instances[1].id, () => null);
    edited = editImported(edited, original.imported.instances[0].id, i => ({ ...i, colorCode: "16" }));
    edited.imported!.instances.push({ ...original.imported.instances[0], id: "added", reference: "added.dat",
      sourceOccurrence: undefined, sourcePath: ["new"], matrix: [...IDENTITY] });
    edited = reverseInstructions(edited);
    const exported = decode(exportMPD(edited));
    assertEffective(exported, edited);
    assertInstructionMembership(exported, edited);
    expect(inlineSurfaces(exported)).toEqual(inlineSurfaces(text));
  });

  it("exports newly constructed parts in their assigned steps without an imported model", () => {
    const doc = createEmptyDocument("New model");
    doc.bricks = [
      { id: "one", type: "brick-1x2", color: "#ff0000", x: 0, y: 0, z: 0, rotation: 0 },
      { id: "two", type: "brick-2x4", color: "#00ff00", x: 1, y: 0, z: 2, rotation: 90 },
    ];
    const edited = updateInstructions(doc, { version: 1, edited: true, source: "manual", warnings: [], steps: [
      { id: "first", title: "First", notes: "", partIds: ["two"] },
      { id: "second", title: "Second", notes: "", partIds: ["one"] },
    ] });
    const text = decode(exportMPD(edited)), parsed = parseLDraw(text);
    expect(parsed.instances.map(i => i.reference)).toEqual(["3001.dat", "3004.dat"]);
    expect(sourceInstructionPlan({ ...fixture().imported, ...parsed }).steps.map(s => s.partIds.length)).toEqual([1, 1]);
  });

  it("refuses section-budget overflow without mutating the source or instruction plan", () => {
    const sections = Array.from({ length: 1023 }, (_, i) => `0 FILE unused-${i}.ldr\n0 !UNKNOWN retained`).join("\n");
    const document = reverseInstructions(fixture(`0 FILE main.ldr\n${ref("a.dat")}\n${sections}`));
    const before = JSON.stringify(document);
    expect(() => exportMPD(document)).toThrow(/1.024/);
    expect(JSON.stringify(document)).toBe(before);
  });

  it("does not shadow external references with generated instruction names", () => {
    const document = reverseInstructions(fixture(`0 FILE main.ldr\n${ref("sub.ldr")}\n${ref("brickbuilder-1.ldr")}\n0 FILE sub.ldr\n${ref("a.dat")}`));
    const text = decode(exportMPD(document));
    assertInstructionMembership(text, document);
    expect(parseLDraw(text).sections).not.toHaveProperty("brickbuilder-1.ldr");
  });
});

for (const filename of [
  "Schild_(1)_1793518004611.io", "ford_mxCopy_Copy-1_1793477649199.io",
  "40649-size_1793502923137.io", "MOC-217408_sebbl_31120_raised_base_MOC_studio_template_v1.0_1794981015703.io",
]) {
  const path = new URL(`../../../../../../attached_assets/${filename}`, import.meta.url);
  it.skipIf(!existsSync(path))(`roundtrips reassigned hierarchical instructions from optional private IO ${filename}`, () => {
    const bytes = new Uint8Array(readFileSync(path)), entries = readZip(bytes, { studioEncryption: true });
    const document = fixture(decode(entries["model.ldr"]));
    document.imported.format = "io";
    document.imported.originalBytes = Array.from(bytes);
    const plan = sourceInstructionPlan(document.imported);
    // The 8,590-leaf source has 4,340 resolved source steps. Reversing all of
    // them exceeds the unchanged 1,024-section MPD safety budget. Exercise that
    // model's geometry in three explicit construction groups instead.
    if (plan.steps.length > 512) {
      const ids = document.imported.instances.map(i => i.id), size = Math.ceil(ids.length / 3);
      plan.steps = Array.from({ length: 3 }, (_, index) => ({
        id: `group-${index}`, title: `Group ${index}`, notes: "",
        partIds: ids.slice(index * size, (index + 1) * size),
      }));
    }
    expect(Buffer.compare(exportIO(document), bytes)).toBe(0);
    const edited = updateInstructions(document, { ...plan, steps: [...plan.steps].reverse().map((step, index) => ({
      ...step, title: `Roundtrip ${index + 1}`,
    })) });
    const exported = readZip(exportIO(edited)), text = decode(exported["model.ldr"]);
    assertEffective(text, edited);
    assertInstructionMembership(text, edited);
    expect(inlineSurfaces(text)).toEqual(inlineSurfaces(document.imported.sourceText));
    expect(bfcGeometry(text)).toEqual(bfcGeometry(document.imported.sourceText));
    expect(Buffer.compare(exported["BrickBuilder/original/model.ldr"], entries["model.ldr"])).toBe(0);
    for (const [name, content] of Object.entries(entries)) {
      const superseded = /^(model\.ldr|model\.ins|modelv2\.ldr|model2\.ldr|model\.lxfml)$/i.test(name);
      const actual = exported[superseded ? `BrickBuilder/original/${name}` : name];
      expect(actual, `Missing archive member ${name}`).toBeDefined();
      expect(Buffer.compare(actual, content), name).toBe(0);
    }
    if (entries["model.ins"]) {
      const parsed = parseLDraw(text);
      const restored = readStudioInstructions(decode(exported["model.ins"]), sourceInstructionPlan({ ...document.imported, ...parsed }));
      expect(restored.steps.map(s => s.title)).toEqual(edited.instructions!.steps.map(s => s.title));
    }
  }, 30_000);
}

describe("occurrence-aware MPD and minimal IO exports", () => {
  it("distinguishes repeated submodels and edits only one nested occurrence", () => {
    const original = fixture();
    expect(new Set(original.imported.instances.map(i => i.sourceOccurrence!.join("/"))).size).toBe(6);
    expect(original.imported.instances[0].sourcePath).toEqual(original.imported.instances[2].sourcePath);
    const edited = rotateImported(recolorImported(original, original.imported.instances[0].id, "#00852B", "2"), original.imported.instances[0].id);
    for (const text of [decode(exportMPD(edited)), decode(readZip(exportIO(edited))["model.ldr"])]) {
      assertEffective(text, edited);
      const parsed = parseLDraw(text), root = parsed.sections[parsed.root];
      expect(referenceLine(root.find(line => /^1 4 /.test(line))!).reference).not.toBe("assembly.ldr");
      expect(root).toContain(ref("assembly.ldr", "14", 100));
      expect(root).toContain(ref("assembly.ldr", "2", 200));
      expect(parsed.sections["inline.dat"]).toContain("3 16 0 0 0 10 0 0 0 10 0");
      expect(inlineSurfaces(text)).toEqual(inlineSurfaces(source));
    }
  });

  it("keeps repeated unmodified sections shared and reuses identical edited variants", () => {
    const original = fixture(`${source}\n`);
    const edited = { ...original, imported: { ...original.imported, edited: true,
      instances: original.imported.instances.map(i => i.reference === "b.dat" ? { ...i, colorCode: "7" } : i) } };
    const text = decode(exportMPD(edited)), parsed = parseLDraw(text);
    assertEffective(text, edited);
    const targets = parsed.sections[parsed.root].filter(line => /^1 /.test(line)).map(line => referenceLine(line).reference);
    expect(new Set(targets).size).toBe(1);
    expect(Object.keys(parsed.sections)).toHaveLength(Object.keys(original.imported.sections).length + 2);
    const untouched = { ...original, imported: { ...original.imported, edited: true } };
    expect(Object.keys(parseLDraw(decode(exportMPD(untouched))).sections)).toEqual(Object.keys(original.imported.sections));
  });

  it("preserves nested reflection, shear, scaling and translations after world-space edits", () => {
    const text = `0 FILE main.ldr
1 72 10 20 30 -1 0.5 0 0 2 0 0 0 3 sub.ldr
0 FILE sub.ldr
1 16 4 5 6 0 0 1 0 1 0 -1 0 0 inner.ldr
0 FILE inner.ldr
${ref("a.dat")}`;
    const original = fixture(text), id = original.imported.instances[0].id;
    const edited = editImported(rotateImported(original, id), id, i => ({ ...i, matrix: i.matrix.map((n, k) => k === 3 ? n + 17.5 : n) as Affine }));
    const exported = decode(exportMPD(edited));
    assertEffective(exported, edited);
    expect(parseLDraw(exported).sections["main.ldr"].find(line => /^1 /.test(line))).toContain("10 20 30 -1 0.5 0 0 2 0 0 0 3");
  });

  it("lifts only edited leaves out of singular ancestors and retains inline surfaces", () => {
    const text = `0 FILE main.ldr
1 4 10 20 30 0 0 0 0 1 0 0 0 1 sub.ldr
0 FILE sub.ldr
3 16 0 0 0 0 10 0 0 0 10
${ref("a.dat")}
${ref("b.dat")}`;
    const original = fixture(text);
    const edited = editImported(original, original.imported.instances[0].id, i => ({ ...i, matrix: [...IDENTITY] }));
    const exported = decode(exportMPD(edited));
    assertEffective(exported, edited);
    expect(inlineSurfaces(exported)).toEqual(inlineSurfaces(text));
    expect(parseLDraw(exported).sections["main.ldr"]).toContain(ref("a.dat", "4"));
  });

  it("writes additions and occurrence deletions without restoring stale original leaves", () => {
    const original = fixture();
    const edited = editImported(original, original.imported.instances[2].id, () => null);
    edited.imported!.instances.push({ ...original.imported.instances[0], id: "new", reference: "new.dat",
      matrix: [1, 0, 0, 500, 0, 1, 0, -20, 0, 0, 1, 90], sourcePath: ["BrickBuilder"], sourceOccurrence: undefined });
    edited.bricks.push({ id: "legacy", type: "brick-2x4", color: "#FF0000", x: 1, y: 0, z: 2, rotation: 90 });
    for (const text of [decode(exportMPD(edited)), decode(readZip(exportIO(edited))["model.ldr"])]) {
      assertEffective(text, edited);
      expect(parseLDraw(text).instances.filter(i => i.reference === "a.dat")).toHaveLength(2);
      expect(parseLDraw(text).instances.some(i => i.reference === "3001.dat")).toBe(true);
      expect(inlineSurfaces(text)).toEqual(inlineSurfaces(source));
    }
  });

  it("retains exact original archive, unknown source records and JSON extension metadata", () => {
    const original = fixture();
    const archive = writeZip({ "model.ldr": encode(source), "unknown/studio.bin": new Uint8Array([0, 254, 1]),
      "model.ins": encode("<UnknownInstruction />") });
    original.imported.format = "io";
    original.imported.originalBytes = Array.from(archive);
    Object.assign(original.imported, { unknownExtension: { nested: ["untouched"] } });
    Object.assign(original.imported.instances[0], { unknownInstanceMetadata: "opaque" });
    original.metadata = { unknown: { data: [1, 2, 3] } };
    const before = JSON.stringify(original);
    const edited = recolorImported(original, original.imported.instances[0].id, "#00852B", "2");
    const restored = importInternal(exportInternal(edited));
    expect(restored.imported).toMatchObject({ originalBytes: Array.from(archive), sourceText: source,
      sections: original.imported.sections, unknownExtension: { nested: ["untouched"] } });
    expect(restored.imported!.instances[0]).toMatchObject({ sourceOccurrence: original.imported.instances[0].sourceOccurrence,
      unknownInstanceMetadata: "opaque" });
    expect(restored.metadata).toEqual(original.metadata);
    const text = decode(exportMPD(restored));
    expect(text).toContain("0 !UNKNOWN preamble payload");
    expect(text).toContain("0 !UNKNOWN unreferenced record");
    expect(text).toContain("0 !UNKNOWN child payload");
    assertEffective(text, restored);
    const generated = readZip(exportIO(restored));
    expect(Object.keys(generated)).toEqual(expect.arrayContaining([".info", "model.ldr", "model.ins", "unknown/studio.bin"]));
    expect(generated["unknown/studio.bin"]).toEqual(new Uint8Array([0, 254, 1]));
    expect(JSON.parse(decode(generated["BrickBuilder/export.json"])).limitations).toContain("Not a lossless Studio");
    expect(JSON.stringify(original)).toBe(before);
    expect(restored.imported!.originalBytes).toEqual(Array.from(archive));
  });

  it("supports unambiguous legacy JSON but refuses ambiguous provenance and duplicate keys", () => {
    const unique = fixture(ref("a.dat", "4"));
    delete unique.imported.instances[0].sourceOccurrence;
    unique.imported.edited = true;
    assertEffective(decode(exportMPD(unique)), unique);
    const ambiguous = fixture();
    ambiguous.imported.edited = true;
    ambiguous.imported.instances.forEach(i => { delete i.sourceOccurrence; });
    expect(() => exportMPD(ambiguous)).toThrow(/ältere Projektstand/);
    const duplicate = fixture();
    duplicate.imported.edited = true;
    duplicate.imported.instances[1].sourceOccurrence = duplicate.imported.instances[0].sourceOccurrence;
    expect(() => exportIO(duplicate)).toThrow(/doppelte Vorkommenskennung/);
  });

  it("does not apply a deleted reference's BFC INVERTNEXT to the following part", () => {
    const original = fixture(`0 FILE main.ldr\n0 BFC INVERTNEXT\n${ref("a.dat", "4")}\n${ref("b.dat", "4")}`);
    const edited = editImported(original, original.imported.instances[0].id, () => null);
    const text = decode(exportMPD(edited));
    assertEffective(text, edited);
    expect(parseLDraw(text).sections["main.ldr"]).not.toContain("0 BFC INVERTNEXT");
  });

  it("does not let generated section names shadow an external reference", () => {
    const original = fixture(`0 FILE main.ldr\n${ref("sub.ldr", "4")}\n${ref("brickbuilder-1.ldr", "4")}\n0 FILE sub.ldr\n${ref("a.dat")}`);
    const edited = rotateImported(original, original.imported.instances[0].id);
    const text = decode(exportMPD(edited));
    assertEffective(text, edited);
    expect(Object.keys(parseLDraw(text).sections)).not.toContain("brickbuilder-1.ldr");
  });

  it("lifts an explicitly effective main color rather than re-inheriting a different ancestor color", () => {
    const original = fixture();
    const edited = editImported(original, original.imported.instances[0].id, i => ({ ...i, colorCode: "16" }));
    assertEffective(decode(exportMPD(edited)), edited);
  });
});

// Local private uploads are never copied into a public fixture or export bundle.
for (const filename of ["ford_mxCopy_Copy-1_1793477649199.io", "40649-size_1793502923137.io"]) {
  const path = new URL(`../../../../../../attached_assets/${filename}`, import.meta.url);
  it.skipIf(!existsSync(path))(`roundtrips edited LDraw occurrences from the optional private fixture ${filename}`, () => {
    const archive = new Uint8Array(readFileSync(path));
    const entries = readZip(archive, { names: ["model.ldr"], studioEncryption: true });
    const original = fixture(decode(entries[Object.keys(entries)[0]]));
    const edited = editImported(rotateImported(original, original.imported.instances[0].id), original.imported.instances[1].id, () => null);
    const text = decode(readZip(exportIO(edited))["model.ldr"]);
    assertEffective(text, edited);
    expect(inlineSurfaces(text)).toEqual(inlineSurfaces(original.imported.sourceText));
  });
}
