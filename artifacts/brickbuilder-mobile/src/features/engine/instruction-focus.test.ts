import { describe, expect, it } from "vitest";
import { Color, InstancedMesh, LineSegments, ShaderLib, ShaderMaterial } from "three";
import { engineFixture } from "./engine-fixtures";
import { createImportedGroup, disposeImportedScene, measureImportedScene } from "./imported-scene";
import { InstanceIndex } from "./instance-index";
import { applyInstructionFocus, FOCUS_ATTRIBUTE, instructionDisplayColor } from "./instruction-focus";
import { applySoftwareInstructionFocus, createSoftwareScene, updateSoftwareScene } from "./software-scene";

function values(root: ReturnType<typeof createImportedGroup>, current?: ReadonlySet<string>) {
  for (const child of root.children as (InstancedMesh | LineSegments)[]) {
    const attribute = child.geometry.getAttribute(FOCUS_ATTRIBUTE);
    (child.userData.brickIds as string[]).forEach((id, i) => {
      expect(attribute.getX(i)).toBe(current === undefined ? 0 : current.has(id) ? 2 : 1);
    });
    if (child instanceof InstancedMesh) expect(attribute.count).toBeGreaterThanOrEqual(child.instanceMatrix.count);
  }
}

describe("occurrence-specific instruction focus", () => {
  it("reuses every draw, geometry, material and buffer across large-model step changes and toggles", () => {
    const model = engineFixture(4000, 2), original = structuredClone(model);
    model.instances[model.instances.length - 1].part.status = "missing";
    const root = createImportedGroup(model);
    const draws = [...root.children] as (InstancedMesh | LineSegments)[];
    const geometry = draws.map(draw => draw.geometry);
    const materials = draws.map(draw => draw.material);
    const attributes = geometry.map(g => g.getAttribute(FOCUS_ATTRIBUTE));
    const before = measureImportedScene(root);
    const newIds = new Set([model.instances[1].id, model.instances.at(-1)!.id]);
    for (const current of [newIds, new Set<string>(), new Set([model.instances[0].id]), undefined]) {
      applyInstructionFocus(root, current); values(root, current);
      expect(root.children).toEqual(draws);
      expect(draws.map(draw => draw.geometry)).toEqual(geometry);
      expect(draws.map(draw => draw.material)).toEqual(materials);
      expect(geometry.map(g => g.getAttribute(FOCUS_ATTRIBUTE))).toEqual(attributes);
      expect(measureImportedScene(root)).toEqual(before);
    }
    // Missing source geometry is not synthesized, recolored or removed from the model.
    expect(root.children.every(draw => !draw.userData.brickIds.includes(model.instances.at(-1)!.id))).toBe(true);
    model.instances.at(-1)!.part.status = original.instances.at(-1)!.part.status;
    expect(model).toEqual(original);
    disposeImportedScene(root);
  });

  it("tracks swap deletion, undo insertion, capacity growth, fixed-color faces and edges", () => {
    const model = engineFixture(6, 2), root = createImportedGroup(model), index = new InstanceIndex(root, model);
    const current = new Set([model.instances[1].id]);
    applyInstructionFocus(root, current);
    const reduced = { ...model, instances: model.instances.slice(1) };
    expect(index.update(reduced)).toBe(true);
    applyInstructionFocus(root, current); values(root, current);
    const inserted = { ...model.instances[0], id: "extra" };
    expect(index.update({ ...model, instances: [...model.instances, inserted] })).toBe(true);
    applyInstructionFocus(root, new Set(["extra"])); values(root, new Set(["extra"]));
    expect(index.counters.capacityGrowths).toBeGreaterThan(0);
    applyInstructionFocus(root); values(root);
    for (const child of root.children) {
      if (child instanceof LineSegments) expect((child.material as ShaderMaterial).uniforms.instructionFocusEnabled.value).toBe(false);
    }
    disposeImportedScene(root);
  });

  it("patches both inherited and fixed-color Lambert shaders without changing their material colors or opacity", () => {
    const root = createImportedGroup(engineFixture(3, 2));
    for (const draw of root.children) {
      if (!(draw instanceof InstancedMesh)) continue;
      const material = draw.material as import("three").MeshLambertMaterial;
      const before = { color: material.color.clone(), opacity: material.opacity, transparent: material.transparent };
      const shader = { vertexShader: ShaderLib.lambert.vertexShader, fragmentShader: ShaderLib.lambert.fragmentShader, uniforms: {} };
      material.onBeforeCompile(shader as never, null as never);
      expect(shader.vertexShader).toContain("vInstructionFocus = instructionFocus;");
      expect(shader.fragmentShader).toContain("vInstructionFocus > 1.5");
      expect(shader.fragmentShader.indexOf("vInstructionFocus > 1.5")).toBeLessThan(shader.fragmentShader.indexOf("#include <colorspace_fragment>"));
      applyInstructionFocus(root, new Set());
      expect(material.color).toEqual(before.color);
      expect(material.opacity).toEqual(before.opacity);
      expect(material.transparent).toEqual(before.transparent);
    }
    disposeImportedScene(root);
  });

  it("updates bounded software display colors without retransforming or replacing source geometry", async () => {
    const model = engineFixture(10, 5), source = structuredClone(model);
    const scene = await createSoftwareScene(model);
    const positions = scene.positions, originalPositions = positions.slice(), colors = [...scene.colors], alpha = scene.alpha.slice();
    const id = model.instances[1].id;
    applySoftwareInstructionFocus(scene, new Set([id]));
    expect(scene.instructionColors).toEqual(scene.colors.map((color, slot) =>
      instructionDisplayColor(new Color(color), scene.triangleIds[slot] === id).getStyle()));
    const display = scene.instructionColors;
    applySoftwareInstructionFocus(scene, new Set());
    expect(scene.instructionColors).toBe(display);
    expect(scene.transformedTriangles).toBe(0);
    expect(scene.positions).toBe(positions);
    expect(scene.positions).toEqual(originalPositions);
    expect(scene.colors).toEqual(colors); expect(scene.alpha).toEqual(alpha);
    const next = { ...model, instances: model.instances.slice(1) };
    updateSoftwareScene(scene, next);
    applySoftwareInstructionFocus(scene, new Set([id]));
    expect(scene.instructionColors![scene.triangleIds.indexOf(id)]).toBe(instructionDisplayColor(new Color(scene.colors[scene.triangleIds.indexOf(id)]), true).getStyle());
    applySoftwareInstructionFocus(scene);
    expect(scene.instructionColors).toBeUndefined();
    expect(model).toEqual(source);
  });
});
