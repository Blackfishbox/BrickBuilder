import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { builderDatabase } from "@/storage/database";
import { importIO } from "./import";
import { exportIO } from "./export";
import { createIOEntrySkipPolicy, includeIOAssemblies, IO_GEOMETRY_LIMITS, readIOAssemblies, readIOGeometry } from "./assemblies";
import { parseLDraw } from "../ldraw/parser";
import { readZip, writeZip, ZIP_LIMITS } from "../zip";
import { exportMPD } from "../mpd/export";
import { importInternal, exportInternal } from "../internal/adapter";
import { compilePart } from "@/features/engine/ldraw-geometry";
import manifest from "../geometry-manifest.json";

const encode = (s: string) => new TextEncoder().encode(s);
const ref = (name: string, color = "16") => `1 ${color} 10 0 0 1 0 0 0 1 0 0 0 1 ${name}`;
const assembly = `0 FILE group.dat\n0 CustomBrick\n${ref("11211.dat")}\n${ref("11211.dat", "14")}`;
const source = encode(ref("group.dat", "4"));
const reference = new URL("../../../../../../attached_assets/MOC-217408_sebbl_31120_raised_base_MOC_studio_template_v1.0_1794981015703.io", import.meta.url);

describe("large Studio archives with project-owned reference assemblies", () => {
  beforeEach(async () => {
    await builderDatabase.open();
    const bytes = await readFile(new URL(`../../../../public/${manifest.url}`, import.meta.url));
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new Uint8Array(bytes))));
  });
  afterEach(async () => { vi.unstubAllGlobals(); await builderDatabase.delete(); });

  it("reads hundreds of entries but decompresses only selected model/assembly payloads", () => {
    const entries: Record<string, Uint8Array> = { "model.ldr": source, "CustomParts/group.dat": encode(assembly) };
    for (let n = 0; n < 380; n++) entries[`CustomParts/collider/${n}.col`] = encode("untouched");
    const read = readZip(writeZip(entries), { names: ["model.ldr"], select: name => /^CustomParts\/[^/]+\.dat$/i.test(name) });
    expect(Object.keys(read)).toHaveLength(2);
    const parsed = parseLDraw(new TextDecoder().decode(includeIOAssemblies(source, readIOAssemblies(read))));
    expect(parsed.instances).toHaveLength(2);
    expect(parsed.instances.map(i => i.colorCode)).toEqual(["4", "14"]);
    expect(parsed.instances[0].matrix[3]).toBe(20);
  });

  it("does not mistake mesh files or ordinary geometry wrappers for editable assemblies", () => {
    const sections = readIOAssemblies({
      "CustomParts/group.dat": encode(assembly),
      "CustomParts/mesh.dat": encode("0 CustomBrick\n3 16 0 0 0 1 0 0 0 1 0"),
      "CustomParts/wrapper.dat": encode(ref("11211.dat")),
    });
    expect(Object.keys(sections)).toEqual(["group.dat"]);
    const existing = encode(`0 FILE main.ldr\n${ref("group.dat")}\n0 FILE group.dat\n${ref("11211.dat", "2")}`);
    expect(includeIOAssemblies(existing, sections)).toBe(existing);
    expect(() => parseLDraw(new TextDecoder().decode(includeIOAssemblies(source,
      { "group.dat": [ref("group.dat")] })))).toThrow(/Zykl/);
  });

  it("still rejects excessive entry counts, unsafe paths and CRC failures", () => {
    const entries = Object.fromEntries(Array.from({ length: ZIP_LIMITS.entries + 1 }, (_, n) => [`${n}.txt`, encode("")]));
    expect(() => readZip(writeZip(entries), { names: ["model.ldr"] })).toThrow(/große Archive/);
    expect(() => readZip(writeZip({ "model.ldr": source, "../unsafe": encode("") }), { names: ["model.ldr"] })).toThrow(/Pfad/);
    const corrupted = writeZip({ "model.ldr": source });
    const view = new DataView(corrupted.buffer, corrupted.byteOffset, corrupted.byteLength);
    for (let n = 0; n < corrupted.length - 4; n++) if (view.getUint32(n, true) === 0x02014b50) { corrupted[n + 16] ^= 1; break; }
    expect(() => readZip(corrupted)).toThrow(/Prüfsumme/);
  });

  it("bounds selected allocation separately from undecompressed archive metadata", () => {
    const bytes = writeZip({ a: encode(""), b: encode(""), c: encode("") });
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    for (let n = 0; n < bytes.length - 46; n++) if (view.getUint32(n, true) === 0x02014b50) {
      view.setUint32(n + 24, ZIP_LIMITS.entryBytes, true);
    }
    expect(() => readZip(bytes)).toThrow(/Speicherbudget/);
    expect(Object.keys(readZip(bytes, { names: [] }))).toEqual([]);
    for (let n = 0; n < bytes.length - 46; n++) if (view.getUint32(n, true) === 0x02014b50) {
      view.setUint32(n + 24, ZIP_LIMITS.declaredBytes + 1, true); break;
    }
    expect(() => readZip(bytes, { names: [] })).toThrow(/groß/);
  });

  it("raises embedded-geometry limits while deciding archive skips before decompression", () => {
    const shouldSkip = createIOEntrySkipPolicy();
    expect(IO_GEOMETRY_LIMITS.perFileBytes).toBe(8 * 1024 * 1024);
    expect(IO_GEOMETRY_LIMITS.totalBytes).toBe(32 * 1024 * 1024);
    expect(shouldSkip("CustomParts/one.dat", IO_GEOMETRY_LIMITS.perFileBytes)).toBeUndefined();
    expect(shouldSkip("CustomParts/too-large.dat", IO_GEOMETRY_LIMITS.perFileBytes + 1)).toBe("io-geometry-file-limit");
    for (let index = 1; index < 4; index++) {
      expect(shouldSkip(`CustomParts/${index}.dat`, IO_GEOMETRY_LIMITS.perFileBytes)).toBeUndefined();
    }
    expect(shouldSkip("CustomParts/over-total.dat", 1)).toBe("io-geometry-total-limit");
    expect(shouldSkip("model.ins", IO_GEOMETRY_LIMITS.instructionsBytes + 1)).toBe("io-instructions-limit");
  });

  it("skips an oversized custom part without aborting the model or changing the original archive", async () => {
    const bytes = writeZip({
      "model.ldr": encode(ref("too-large.dat")),
      "CustomParts/too-large.dat": new Uint8Array(IO_GEOMETRY_LIMITS.perFileBytes + 1),
    });
    const doc = await importIO(bytes, "oversized-custom.io", { online: false });
    expect(doc.imported!.instances).toHaveLength(1);
    expect(doc.imported!.instances[0].part.status).toBe("missing");
    expect(doc.imported!.issues).toContainEqual(expect.objectContaining({
      code: "io-geometry-file-limit", reference: "too-large.dat",
    }));
    expect(doc.imported!.originalBytes).toEqual(Array.from(bytes));
    expect(exportIO(doc)).toEqual(bytes);
  }, 30_000);

  it("accepts geometries above the old 4 MiB limit and keeps them in JSON backups", async () => {
    const content = `0 Private geometry\n3 16 0 0 0 20 0 0 0 20 0\n0 ${"x".repeat(5 * 1024 * 1024)}\n`;
    const doc = await importIO(writeZip({
      "model.ldr": encode(ref("large-but-supported.dat")),
      "CustomParts/large-but-supported.dat": encode(content),
    }), "large-custom.io", { online: false });
    expect(doc.imported!.instances[0].part.status).toBe("resolved");
    expect(doc.imported!.resources["parts/large-but-supported.dat"].content).toHaveLength(content.length);
    const restored = importInternal(exportInternal(doc));
    expect(restored.imported!.resources["parts/large-but-supported.dat"].content).toHaveLength(content.length);
  }, 30_000);

  it("uses declared subpart identity only for Studio's duplicated s/s transport folder", () => {
    const content = "0 FILE s/petal.dat\n0 Author: Synthetic fixture\n3 16 0 0 0 20 0 0 0 20 0";
    const files = readIOGeometry({ "CustomParts/s/s/petal.dat": encode(content) }, {});
    expect(Object.keys(files)).toEqual(["parts/s/petal.dat"]);
    expect(files["parts/s/petal.dat"]).toMatchObject({ content, sourceArchivePath: "CustomParts/s/s/petal.dat", license: "Project-source" });
    const wrongAlias = readIOGeometry({ "CustomParts/another.dat": encode(content) }, {});
    expect(Object.keys(wrongAlias)).toEqual(["parts/another.dat"]);
  });

  it("never shares private geometry or roots depending on it with other projects", async () => {
    const doc = await importIO(writeZip({
      "model.ldr": encode(`${ref("private.dat")}\n${ref("11211.dat")}`),
      "CustomParts/private.dat": encode(`0 Project-local mesh\n${ref("11211.dat")}`),
    }), "private-mesh.io", { online: false });
    expect(doc.imported!.instances.every(i => i.part.status === "resolved")).toBe(true);
    const snapshots = await builderDatabase.geometrySnapshots.toArray();
    expect(snapshots.length).toBeGreaterThan(0);
    expect(snapshots.flatMap(s => s.roots)).not.toContain("private.dat");
    expect(snapshots.flatMap(s => s.files).every(file => file.license !== ("Project-source" as string))).toBe(true);
    expect(await builderDatabase.libraryFiles.count()).toBe(0);
    const restored = importInternal(exportInternal(doc));
    expect(restored.imported!.resources["parts/private.dat"].license).toBe("Project-source");
    restored.imported!.resources["parts/private.dat"].sourceUrl = "https://example.invalid/claimed-license";
    expect(() => importInternal(exportInternal(restored))).toThrow(/Herkunft/);
  });

  it("rejects embedded coordinates that would overflow GPU buffers instead of crashing the canvas", async () => {
    const doc = await importIO(writeZip({
      "model.ldr": encode(ref("oversized.dat")),
      "CustomParts/oversized.dat": encode("0 Private mesh\n3 16 0 0 0 1e300 0 0 0 20 0"),
    }), "overflow.io", { online: false });
    expect(doc.imported!.instances[0].part.status).toBe("missing");
    expect(doc.imported!.issues.some(issue => issue.code === "geometry-invalid")).toBe(true);
  });

  it("keeps expanded occurrence paths through geometry, JSON and edited MPD/IO round trips", async () => {
    const bytes = writeZip({ "model.ldr": source, "CustomParts/group.dat": encode(assembly), "unknown.bin": encode("preserved") });
    const doc = await importIO(bytes, "assembly.io", { online: false });
    expect(doc.imported!.instances).toHaveLength(2);
    expect(doc.imported!.instances.every(i => i.part.status === "resolved")).toBe(true);
    expect(exportIO(doc)).toEqual(bytes);
    expect(importInternal(exportInternal(doc)).imported!.instances).toHaveLength(2);
    doc.imported!.instances[0].colorCode = "2"; doc.imported!.edited = true;
    expect(parseLDraw(new TextDecoder().decode(exportMPD(doc))).instances.map(i => i.colorCode)).toEqual(["2", "14"]);
    const output = exportIO(doc);
    expect(readZip(output)["unknown.bin"]).toEqual(encode("preserved"));
    expect((await importIO(output, "edited.io", { online: false })).imported!.instances).toHaveLength(2);
  });

  it.skipIf(!existsSync(reference))("imports all 356 references from the private 382-entry uploaded template", async () => {
    const bytes = new Uint8Array(await readFile(reference));
    const doc = await importIO(bytes, "private-template.io", { online: false });
    const model = doc.imported!;
    expect(model.instances).toHaveLength(356);
    expect(model.instances.every(i => !i.reference.toLowerCase().startsWith("mf2e6"))).toBe(true);
    expect(model.instances.filter(i => i.part.status !== "resolved").map(i => i.reference)).toEqual([]);
    for (const instance of model.instances.filter(i => i.part.status === "resolved")) {
      expect(compilePart(model, instance.reference, instance.colorCode).some(surface => surface.positions.length)).toBe(true);
    }
    expect(exportIO(doc)).toEqual(bytes);
    expect(importInternal(exportInternal(doc)).imported!.instances).toHaveLength(356);
    model.instances[0].matrix[3] += 20; model.edited = true;
    const output = await importIO(exportIO(doc), "edited-template.io", { online: false });
    expect(output.imported!.instances).toHaveLength(356);
    expect(output.imported!.instances[0].matrix).toEqual(model.instances[0].matrix);
  }, 30_000);
});
