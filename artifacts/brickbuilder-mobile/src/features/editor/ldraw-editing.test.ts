import { afterEach, describe, expect, it, vi } from "vitest";
import { Ray, Vector3 } from "three";
import { createEmptyDocument } from "./model";
import { brickBounds } from "./brick-transform";
import { commit, createHistory, redo, undo } from "./history";
import { editImported, enrichImportedGeometry, moveImported, placePreparedPart, recolorImported, rotateImported, rotateSelection, setImportedRotation, tiltImported, type PreparedPart } from "./ldraw-editing";
import { parseLDraw } from "../formats/ldraw/parser";
import { exportInternal, importInternal } from "../formats/internal/adapter";
import { exportLDR } from "../formats/ldraw/export";
import { exportMPD } from "../formats/mpd/export";
import { exportIO } from "../formats/io/export";
import { readZip } from "../formats/zip";
import type { ImportedModel } from "../formats/types";
import { compilePart, createImportedGroup, reuseGeometryCache, worldMatrix } from "../engine/ldraw-geometry";
import { importedSelectionBounds, pickSoftwareInstance } from "../engine/imported-selection";
import { createSoftwareScene } from "../engine/software-scene";
import { disposeImportedScene } from "../engine/imported-scene";
import { builderDatabase, loadProject, saveProject } from "@/storage/database";

function fixture() {
  const text = "0 Synthetic editing fixture\n1 4 0 0 0 1 0 0 0 1 0 0 0 1 test.dat\n1 14 100 0 0 1 0 0 0 1 0 0 0 1 test.dat\n";
  const imported: ImportedModel = {
    version: 1, format: "mpd", sourceName: "editing.mpd", sourceText: text,
    originalBytes: Array.from(new TextEncoder().encode(text)), ...parseLDraw(text),
    resources: { "parts/test.dat": { path: "parts/test.dat", author: "Synthetic fixture author", license: "CC0-1.0", sourceUrl: "https://example.invalid/test.dat",
      content: "0 Synthetic test surface\n3 16 0 0 0 20 0 0 0 20 0\n" } },
    legalDocuments: [],
  };
  imported.instances.forEach(instance => { instance.part.status = "resolved"; });
  return { ...createEmptyDocument(), imported };
}
afterEach(async () => { vi.unstubAllGlobals(); await builderDatabase.delete(); });

describe("editable imported LDraw instances", () => {
  it("edits only the selected occurrence and keeps all original upload metadata untouched", () => {
    const original = fixture(), id = original.imported.instances[0].id;
    const source = JSON.stringify([original.imported.sourceText, original.imported.originalBytes, original.imported.sections]);
    const rotated = rotateImported(recolorImported(original, id, "#AEE9EF", "43"), id);
    const moved = moveImported(rotated, id, { x: 3.25, y: -0.4, z: 8 });
    expect(moved.imported!.instances[0].matrix.map(value => Number(value.toFixed(10))))
      .toEqual([0, 0, 1, 70, 0, 1, 0, 8, -1, 0, 0, 160]);
    expect(moved.imported!.instances[0]).toMatchObject({ colorCode: "43", color: { alpha: 128 } });
    expect(moved.imported!.instances[1]).toBe(original.imported.instances[1]);
    expect(JSON.stringify([moved.imported!.sourceText, moved.imported!.originalBytes, moved.imported!.sections])).toBe(source);
    expect(original.imported.instances[0].colorCode).toBe("4");
    expect(original.imported.instances[0].matrix[3]).toBe(0);
  });
  it("preserves arbitrary source basis, reflection and pivot across four rotations", () => {
    let document = fixture();
    document.imported.instances[0].matrix = [-1, 0.25, 0, 12, 0, 1, 0.5, -31, 0, 0, 2, 44];
    const before = [...document.imported.instances[0].matrix];
    for (let i = 0; i < 4; i++) document = rotateImported(document, document.imported.instances[0].id) as typeof document;
    expect(document.imported.instances[0].matrix).toEqual(before);
  });
  it("tilts imported parts around their geometry center, survives movement, and can be reset", () => {
    const original = fixture(), id = original.imported.instances[0].id;
    const base = original.imported.instances[0].matrix;
    const center = new Vector3(10, 10, 0).applyMatrix4(worldMatrix(base));
    const tilted = tiltImported(original, id, 25, -13);
    const instance = tilted.imported!.instances[0];
    expect(instance).toMatchObject({ tiltX: 25, tiltZ: -13 });
    expect(instance.matrix).not.toEqual(base);
    expect(new Vector3(10, 10, 0).applyMatrix4(worldMatrix(instance.matrix)).distanceTo(center)).toBeLessThan(1e-8);
    const moved = moveImported(tilted, id, { x: 2.5, y: 0.8, z: -1.25 }, false);
    expect(moved.imported!.instances[0].tiltX).toBe(25);
    const reset = tiltImported(moved, id, 0, 0);
    expect(reset.imported!.instances[0].matrix).toEqual(moved.imported!.instances[0].tiltBaseMatrix);
    expect(reset.imported!.instances[0].tiltX).toBeUndefined();
    expect(importInternal(exportInternal(tilted)).imported!.instances[0]).toMatchObject({ tiltX: 25, tiltZ: -13 });
  });
  it("sets arbitrary imported yaw independently of tilt and reapplies it from the stable source transform", () => {
    const original = fixture(), id = original.imported.instances[0].id;
    const source = original.imported.instances[0];
    const yawed = setImportedRotation(original, id, 37.5);
    const instance = yawed.imported!.instances[0];
    expect(instance.rotationY).toBe(37.5);
    expect(instance.matrix.slice(3, 4)).toEqual(source.matrix.slice(3, 4));
    expect(instance.matrix.slice(11, 12)).toEqual(source.matrix.slice(11, 12));
    expect(instance.matrix).not.toEqual(source.matrix);

    const tilted = tiltImported(yawed, id, 25, -13);
    expect(tilted.imported!.instances[0]).toMatchObject({ rotationY: 37.5, tiltX: 25, tiltZ: -13 });
    const editedAgain = setImportedRotation(tilted, id, 82.25);
    expect(editedAgain.imported!.instances[0]).toMatchObject({ rotationY: 82.25, tiltX: 25, tiltZ: -13 });
    const reset = setImportedRotation(editedAgain, id, 0);
    expect(reset.imported!.instances[0]).toMatchObject({ tiltX: 25, tiltZ: -13 });
    expect(reset.imported!.instances[0].rotationY).toBeUndefined();
    expect(setImportedRotation(original, id, 360).imported!.instances[0].matrix).toEqual(source.matrix);
    expect(setImportedRotation(original, id, 361).imported!.instances[0].rotationY).toBe(360);
    expect(setImportedRotation(original, id, -1).imported!.instances[0].rotationY).toBeUndefined();
  });
  it("keeps a selected evidence-backed connection point fixed through rotation, saves, undo and exports", async () => {
    const original = fixture(), id = original.imported.instances[0].id;
    const source = original.imported.instances[0];
    source.matrix = [1, 0, 0, 40, 0, 1, 0, -20, 0, 0, 1, 60];
    const pivot: [number, number, number] = [20, 0, 0];
    const anchorBefore = new Vector3(...pivot).applyMatrix4(worldMatrix(source.matrix));
    const rotated = rotateSelection(original, [id], id, 90, 0, pivot);
    const instance = rotated.imported!.instances[0];
    const anchorAfter = new Vector3(...pivot).applyMatrix4(worldMatrix(instance.matrix));

    expect(anchorAfter.distanceTo(anchorBefore)).toBeLessThan(1e-8);
    expect(instance.matrix[3]).not.toBe(source.matrix[3]);
    expect(instance).toMatchObject({ rotationY: 90, rotationPivot: pivot });
    const changedPivotAngle = setImportedRotation(rotated, id, 135);
    expect(changedPivotAngle.imported!.instances[0].rotationPivot).toEqual(pivot);
    expect(new Vector3(...pivot).applyMatrix4(worldMatrix(changedPivotAngle.imported!.instances[0].matrix))
      .distanceTo(anchorBefore)).toBeLessThan(1e-8);

    const saved = importInternal(exportInternal(rotated));
    expect(saved.imported!.instances[0].rotationPivot).toEqual(pivot);
    for (const bytes of [exportLDR(rotated), exportMPD(rotated), readZip(exportIO(rotated))["model.ldr"]]) {
      expect(parseLDraw(new TextDecoder().decode(bytes)).instances[0].matrix)
        .toEqual(instance.matrix.map(value => value || 0));
    }

    const history = commit(createHistory(original), rotated);
    expect(undo(history).document).toEqual(original);
    expect(redo(undo(history)).document).toEqual(rotated);
    await builderDatabase.open();
    await saveProject(rotated);
    expect((await loadProject(rotated.id))!.imported!.instances[0].rotationPivot).toEqual(pivot);
  });
  it("rotates a mixed selection around its shared center and records one restorable edit", async () => {
    const document = fixture();
    const localA = { id: "local-a", type: "brick-2x4" as const, color: "#B40000", x: 0, y: 0, z: 0, rotation: 0 };
    const localB = { id: "local-b", type: "brick-2x2" as const, color: "#B40000", x: 10, y: 0, z: 0, rotation: 30 };
    document.bricks = [localA, localB];
    const importedA = document.imported!.instances[0], importedB = document.imported!.instances[1];
    importedB.matrix = [...importedB.matrix] as typeof importedB.matrix;
    importedB.matrix[3] = 100;
    const selectedIds = [localA.id, localB.id, importedB.id];
    const rotated = rotateSelection(document, selectedIds, localA.id, 90);

    expect(rotated.bricks.map(brick => brick.rotation)).toEqual([90, 120]);
    expect(rotated.bricks[0].x).toBeCloseTo(5);
    expect(rotated.bricks[0].z).toBeCloseTo(5);
    expect(rotated.bricks[1].x).toBeCloseTo(5);
    expect(rotated.bricks[1].z).toBeCloseTo(-5);
    const movedImported = rotated.imported!.instances.find(instance => instance.id === importedB.id)!;
    expect(movedImported.rotationY).toBe(90);
    expect(movedImported.matrix[3] / 20).toBeCloseTo(5);
    expect(movedImported.matrix[11] / 20).toBeCloseTo(0);
    expect(rotated.imported!.instances.find(instance => instance.id === importedA.id)).toEqual(importedA);

    const oneEdit = commit(createHistory(document), rotated);
    expect(oneEdit.past).toHaveLength(1);
    expect(undo(oneEdit).document.bricks).toEqual(document.bricks);
    expect(undo(oneEdit).document.imported!.instances).toEqual(document.imported!.instances);
    expect(redo(undo(oneEdit)).document).toEqual(rotated);
    await builderDatabase.open();
    await saveProject(rotated);
    const saved = await loadProject(rotated.id);
    expect(saved?.bricks).toEqual(rotated.bricks);
    expect(saved?.imported).toEqual(rotated.imported);
  });
  it("lifts a rotated tilted group above the floor without changing its vertical spacing", () => {
    const tilted = {
      id: "tilted", type: "brick-2x4" as const, color: "#B40000",
      x: 0, y: 1, z: 0, rotation: 90, tiltX: 45,
    };
    const upright = {
      id: "upright", type: "brick-2x2" as const, color: "#B40000",
      x: 4, y: 0, z: 0, rotation: 0,
    };
    const document = { ...createEmptyDocument(), bricks: [tilted, upright] };
    const rotated = rotateSelection(document, [tilted.id, upright.id], tilted.id, 0);
    const movedTilted = rotated.bricks.find(brick => brick.id === tilted.id)!;
    const movedUpright = rotated.bricks.find(brick => brick.id === upright.id)!;
    expect(brickBounds(movedTilted).min.y).toBeGreaterThanOrEqual(-1e-9);
    expect(brickBounds(movedUpright).min.y).toBeGreaterThanOrEqual(-1e-9);
    expect(movedTilted.y - tilted.y).toBeGreaterThan(0);
    expect(movedTilted.y - tilted.y).toBeCloseTo(movedUpright.y - upright.y);
  });
  it("restores imported deletion, colors and transforms with undo/redo", () => {
    const document = fixture(), id = document.imported.instances[0].id;
    let history = createHistory(document);
    history = commit(history, recolorImported(history.document, id, "#FAC80A", "14"));
    history = commit(history, rotateImported(history.document, id));
    history = commit(history, editImported(history.document, id, () => null));
    expect(history.document.imported!.instances).toHaveLength(1);
    history = undo(history); expect(history.document.imported!.instances).toHaveLength(2);
    history = undo(history); expect(history.document.imported!.instances[0].matrix).toEqual(document.imported.instances[0].matrix);
    history = undo(history); expect(history.document.imported!.instances[0].colorCode).toBe("4");
    history = redo(redo(redo(history))); expect(history.document.imported!.instances).toHaveLength(1);
  });
  it("persists the edited flag and effective instances through IndexedDB and internal JSON", async () => {
    await builderDatabase.open();
    const original = fixture(), id = original.imported.instances[0].id;
    const edited = setImportedRotation(tiltImported(recolorImported(original, id, "#00852B", "2"), id, 25, -13), id, 42.75);
    await saveProject(edited);
    const reopened = await loadProject(edited.id);
    expect(reopened!.imported).toEqual(edited.imported);
    const roundtrip = importInternal(exportInternal(edited));
    expect(roundtrip.imported!.edited).toBe(true);
    expect(roundtrip.imported!.instances[0]).toMatchObject({ rotationY: 42.75, tiltX: 25, tiltZ: -13 });
    expect(roundtrip.imported!.instances[0].matrix).toEqual(edited.imported!.instances[0].matrix.map(value => value || 0));
    expect(roundtrip.imported!.originalBytes).toEqual(original.imported.originalBytes);
  });
  it("exports edited effective parts rather than the stale original MPD source", () => {
    const original = fixture(), id = original.imported.instances[0].id;
    const edited = editImported(rotateImported(recolorImported(original, id, "#00852B", "2"), id), original.imported.instances[1].id, () => null);
    for (const bytes of [exportLDR(edited), exportMPD(edited), readZip(exportIO(edited))["model.ldr"]]) {
      const parsed = parseLDraw(new TextDecoder().decode(bytes));
      expect(parsed.instances).toHaveLength(1);
      expect(parsed.instances[0].colorCode).toBe("2");
      expect(parsed.instances[0].matrix).toEqual(edited.imported!.instances[0].matrix.map(value => value || 0));
    }
    expect(new TextDecoder().decode(exportMPD(original))).toBe(original.imported.sourceText);
  });
  it("never resurrects deleted parts or overwrites edits when older geometry results arrive", () => {
    const original = fixture(), id = original.imported.instances[0].id;
    const edited = editImported(recolorImported(original, id, "#FAC80A", "14"), original.imported.instances[1].id, () => null);
    const enriched = enrichImportedGeometry(edited.imported!, original.imported);
    expect(enriched.instances).toHaveLength(1);
    expect(enriched.instances[0].colorCode).toBe("14");
    expect(enriched.edited).toBe(true);
  });
  it("places actual prepared LDraw geometry, not one of the procedural legacy bricks", () => {
    const original = fixture();
    const prepared: PreparedPart = {
      part: { id: "test", packageId: "test", ldrawId: "test", name: "Test part", category: "Test", keywords: [], file: "parts/test.dat" },
      model: original.imported, bottom: -1,
    };
    const placed = placePreparedPart(createEmptyDocument(), prepared, { x: 2, y: 0.4, z: 3 }, "#FAC80A", "14");
    expect(placed.bricks).toHaveLength(0);
    expect(placed.imported!.instances).toHaveLength(1);
    expect(placed.imported!.instances[0]).toMatchObject({ reference: "test.dat", colorCode: "14" });
    expect(placed.imported!.instances[0].matrix[7]).toBeCloseTo(-28);
    expect(placed.imported!.resources["parts/test.dat"]).toBe(original.imported.resources["parts/test.dat"]);
  });
  it("reuses compiled buffers after color or matrix edits without modifying older snapshots", () => {
    const original = fixture();
    const compiled = compilePart(original.imported, "test.dat", "4");
    const edited = recolorImported(original, original.imported.instances[0].id, "#FAC80A", "14");
    reuseGeometryCache(original.imported, edited.imported!);
    expect(compilePart(edited.imported!, "test.dat", "14")[0].positions).toBe(compiled[0].positions);
  });
  it("maps GPU instance IDs and bounds and hits the nearest software triangle", async () => {
    const document = fixture(), model = document.imported;
    const root = createImportedGroup(model);
    const bounds = importedSelectionBounds(root, model.instances[1].id)!;
    expect(bounds.min.x).toBeCloseTo(5);
    expect(bounds.max.x).toBeCloseTo(6);
    const software = await createSoftwareScene(model);
    const hit = pickSoftwareInstance(new Ray(new Vector3(0.2, -0.2, 2), new Vector3(0, 0, -1)), software, 0);
    expect(hit?.id).toBe(model.instances[0].id);
    expect(hit?.point.z).toBeCloseTo(0);
    disposeImportedScene(root);
  });
});
