import { readFileSync } from "node:fs";
import { gunzipSync } from "fflate";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { inspectFile, OFFICIAL, UNOFFICIAL } from "@workspace/ldraw-source";
import { builderDatabase } from "@/storage/database";
import { compilePart } from "../engine/ldraw-geometry";
import { importLDraw } from "./ldraw/import";
import { importIO } from "./io/import";
import manifest from "./geometry-manifest.json";
import { describeConnections } from "../connections/description";
import { activeConnections, constructionTransform } from "../connections/engine";
import { connectionFixture, partLine } from "../connections/fixtures";
import { Ray, Triangle, Vector3 } from "three";

const bundle = new Uint8Array(readFileSync(new URL(`../../../public/${manifest.url}`, import.meta.url)));
const snapshot = JSON.parse(new TextDecoder().decode(gunzipSync(bundle)));
beforeEach(async () => {
  await builderDatabase.open();
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (!String(url).includes(manifest.url)) throw new Error("No live geometry requests allowed");
    return new Response(bundle);
  }));
});
afterEach(async () => { vi.unstubAllGlobals(); vi.restoreAllMocks(); await builderDatabase.delete(); });

it("retains the actual unofficial source, author, license and complete renderable closure", async () => {
  const source = snapshot.files.find((file: { path: string }) => file.path === "parts/5844.dat");
  const inspected = inspectFile(source.path, new TextEncoder().encode(source.content), UNOFFICIAL);
  expect(inspected.sourceUrl).toBe(`${UNOFFICIAL}parts/5844.dat`);
  expect(inspected.author).toBe("Rene Rechthaler [Blechtaler]");
  expect(inspected.license).toBe("CC-BY-4.0");
  expect(() => inspectFile(source.path, new TextEncoder().encode(source.content), "https://example.invalid/" as typeof OFFICIAL)).toThrow();
  const doc = await importLDraw(new TextEncoder().encode("1 15 0 0 0 1 0 0 0 1 0 0 0 1 5844.dat"), "synthetic.ldr", "ldr", undefined, { online: false });
  expect(doc.imported!.instances[0].part.status).toBe("resolved");
  expect(compilePart(doc.imported!, "5844.dat", "15").some(surface => surface.positions.length > 0)).toBe(true);
  expect(Object.keys(doc.imported!.resources)).toHaveLength(19);
  expect(doc.imported!.legalDocuments.some(document => document.name === "CAlicense4.txt")).toBe(true);
});

it("reuses the credited reviewed closure offline without losing unofficial provenance", async () => {
  const bytes = new TextEncoder().encode("1 4 0 0 0 1 0 0 0 1 0 0 0 1 5844.dat");
  await importLDraw(bytes, "synthetic.ldr");
  const offline = vi.fn().mockRejectedValue(new Error("Offline"));
  vi.stubGlobal("fetch", offline);
  const restored = await importLDraw(bytes, "synthetic.ldr", "ldr", undefined, { online: false });
  expect(restored.imported!.instances[0].part.status).toBe("resolved");
  expect(restored.imported!.resources["parts/5844.dat"].sourceUrl).toBe(`${UNOFFICIAL}parts/5844.dat`);
  expect(restored.imported!.issues.some(issue => issue.code === "geometry-cache")).toBe(false);
  expect(offline).not.toHaveBeenCalled();
});

it("uses only the two source-verified underside sockets for the exact 5844 source", async () => {
  const bytes = new TextEncoder().encode("1 4 0 0 0 1 0 0 0 1 0 0 0 1 5844.dat");
  const model = (await importLDraw(bytes, "5844.ldr", "ldr", undefined, { online: false })).imported!;
  const connectors = describeConnections("5844.dat", model).connectors;
  const sockets = connectors.filter(connector => connector.gender === "F" && connector.evidence.path === "parts/5844.dat");
  expect(model.resources["parts/5844.dat"].sha256).toBe("fff4b7dfa90dd38fef81efe381be295a7d8442f5c3b181c45b95495e5400b73d");
  expect(sockets.map(socket => [socket.frame[3], socket.frame[7], socket.frame[11]])).toEqual([[0, 56, -60], [0, 56, 0]]);
  const changedSource = {
    ...model,
    resources: { ...model.resources, "parts/5844.dat": { ...model.resources["parts/5844.dat"], sha256: "0".repeat(64) } },
  };
  expect(describeConnections("5844.dat", changedSource).connectors
    .filter(connector => connector.gender === "F" && connector.evidence.path === "parts/5844.dat")).toHaveLength(0);

  // Check a full 6-LDU stud footprint at both feet through the first 4 LDU.
  const surfaces = compilePart(model, "5844.dat", "16");
  for (const z of [-60, 0]) for (const [xOffset, zOffset] of [
    [0, 0], [5.5, 0], [-5.5, 0], [0, 5.5], [0, -5.5],
  ]) {
    const ray = new Ray(new Vector3(xOffset, 56.25, z + zOffset), new Vector3(0, -1, 0));
    const point = new Vector3(), triangle = new Triangle();
    for (const surface of surfaces) for (let i = 0; i < surface.positions.length; i += 9) {
      triangle.a.fromArray(surface.positions, i); triangle.b.fromArray(surface.positions, i + 3); triangle.c.fromArray(surface.positions, i + 6);
      const hit = ray.intersectTriangle(triangle.a, triangle.b, triangle.c, false, point);
      expect(!hit || hit.y <= 52.01 || hit.y >= 56.24, `unexpected solid inside 5844 socket at ${xOffset},${z + zOffset},${hit?.y}`).toBe(true);
    }
  }
});

it("magnetically seats 5844's two verified feet onto real 3001 studs", async () => {
  const bytes = new TextEncoder().encode("1 4 0 0 0 1 0 0 0 1 0 0 0 1 5844.dat");
  const arch = (await importLDraw(bytes, "5844.ldr", "ldr", undefined, { online: false })).imported!;
  const model = connectionFixture([
    partLine("3001", 0, -24, 0, "0 0 1 0 1 0 -1 0 0"),
    partLine("5844", 160, -80),
  ].join("\n"));
  model.resources = { ...model.resources, ...arch.resources };
  const movingId = model.instances[1].id;
  const result = constructionTransform(model, movingId, { x: 0.5, y: 4, z: 1.5 });
  expect(result.contacts).toHaveLength(2);
  expect(result.matrix).toEqual([1, 0, 0, 10, 0, 1, 0, -80, 0, 0, 1, 30]);
  const committed = {
    ...model,
    instances: model.instances.map(instance => instance.id === movingId ? { ...instance, matrix: result.matrix } : instance),
  };
  expect(activeConnections(committed, movingId)).toHaveLength(2);
});

it.skipIf(!process.env.BRICKBUILDER_IO_REFERENCE)("resolves all 20 occurrences in the optional private Studio reference", async () => {
  const bytes = new Uint8Array(readFileSync(process.env.BRICKBUILDER_IO_REFERENCE!));
  const doc = await importIO(bytes, "private-reference.io", { online: false });
  const instances = doc.imported!.instances.filter(instance => instance.reference === "5844.dat");
  expect(instances).toHaveLength(20);
  expect(instances.every(instance => instance.part.status === "resolved")).toBe(true);
  expect(doc.imported!.issues.some(issue => issue.code === "missing-part" && issue.reference === "5844.dat")).toBe(false);
  expect(new Uint8Array(doc.imported!.originalBytes)).toEqual(bytes);
}, 60000);
