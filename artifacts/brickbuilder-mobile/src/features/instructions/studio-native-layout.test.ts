import { expect, it } from "vitest";
import { Euler, Matrix4, PerspectiveCamera, Quaternion, Vector3 } from "three";
import { DEFAULT_INSTRUCTION_PHI, DEFAULT_INSTRUCTION_THETA } from "../engine/instruction-camera";
import { studioCalloutStep, studioFrameHeight, studioPdfStep, studioResizeSlots } from "./studio-native-layout";
import { createEmptyDocument } from "../editor/model";
import { parseLDraw } from "../formats/ldraw/parser";

it("resolves a vertically split first column beside three full-height columns", () => {
  const rects = studioResizeSlots({
    resizeBars: "True -1 -1 0.25 True -1 -1 0.5 True -1 -1 0.75 False -1 0 0.5",
  }, [
    { refResizeBarRight: "0", refResizeBarBottom: "3" },
    { refResizeBarRight: "0", refResizeBarTop: "3" },
    { refResizeBarLeft: "0", refResizeBarRight: "1" },
    { refResizeBarLeft: "1", refResizeBarRight: "2" },
    { refResizeBarLeft: "2" },
  ]);
  expect(rects).toEqual([[0, 0, 0.25, 0.5], [0, 0.5, 0.25, 0.5],
    [0.25, 0, 0.25, 1], [0.5, 0, 0.25, 1], [0.75, 0, 0.25, 1]]);
});

it("rejects malformed or reversed bar references rather than creating invalid slots", () => {
  expect(studioResizeSlots({ resizeBars: "True -1 -1 0.5" }, [{ refResizeBarLeft: "9" }])).toBeUndefined();
  expect(studioResizeSlots({ resizeBars: "False -1 -1 0.5" }, [{ refResizeBarLeft: "0" }])).toBeUndefined();
  expect(studioResizeSlots({ resizeBars: "True -1 -1 2" }, [{}])).toBeUndefined();
  expect(studioResizeSlots({}, [{}])).toBeUndefined();
});

for (const [pitch, yaw] of [[-0.6154797, 0.7853982], [-3.7570724, 2.3561945], [-3.7570724, -2.3561945]]) {
  it(`matches the Studio camera including an orbit beyond a pole (${pitch}, ${yaw})`, () => {
    const step = { id: "step", title: "", notes: "", partIds: [], rotation: [0, 0, 0] as [number, number, number] };
    const view = studioPdfStep(step, { cameraAngle: `${pitch} ${yaw}`, modelAngle: "0 0 0" });
    const orientation = (theta: number, phi: number, native = false) => {
      const camera = new PerspectiveCamera();
      camera.position.set(Math.sin(phi) * Math.sin(theta), Math.cos(phi), Math.sin(phi) * Math.cos(theta));
      if (native) camera.up.set(-Math.cos(phi) * Math.sin(theta), Math.sin(phi), -Math.cos(phi) * Math.cos(theta));
      camera.lookAt(new Vector3());
      return camera.quaternion.clone();
    };
    const rendered = orientation(DEFAULT_INSTRUCTION_THETA, DEFAULT_INSTRUCTION_PHI).invert()
      .multiply(new Quaternion().setFromEuler(new Euler(...view.rotation!.map(v => v * Math.PI / 180) as [number, number, number])));
    const expected = orientation(Math.PI - yaw, Math.PI / 2 + pitch, true).invert();
    expect(Math.abs(rendered.dot(expected))).toBeCloseTo(1, 6);
    expect(step.rotation).toEqual([0, 0, 0]);
  });
}

it("keeps an explicitly saved BrickBuilder camera and handles legacy source names", () => {
  const step = { id: "step", title: "", notes: "", partIds: [] };
  expect(studioPdfStep(step, { DefaultCameraControlInfo_cameraAngle: "-0.6 0.7" }).rotation).toBeDefined();
  const saved = { ...step, camera: { phi: 1, theta: 1, distance: 4, referenceDistance: 4,
    target: [0, 0, 0] as [number, number, number], referenceTarget: [0, 0, 0] as [number, number, number] } };
  expect(studioPdfStep(saved, { cameraAngle: "-0.6 0.7" })).toBe(saved);
});

it("keeps source zoom consistent across slots rather than magnifying each small assembly", () => {
  expect(studioFrameHeight({ cameraScale: "170" }, 50, 200)).toBeCloseTo(4.25);
  expect(studioFrameHeight({ DefaultCameraControlInfo_cameraScale: "340" }, 50, 200)).toBeCloseTo(8.5);
  expect(studioFrameHeight({}, 50, 200)).toBeUndefined();
});

it("removes the parent occurrence's tilt from a callout without changing its source matrices", () => {
  const source = [
    "0 FILE root.ldr",
    "1 16 10 20 30 1 0 0 0 0 -1 0 1 0 child.ldr",
    "0 FILE child.ldr",
    "1 0 0 0 0 1 0 0 0 1 0 0 0 1 43093.dat",
    "1 15 20 0 0 1 0 0 0 1 0 0 0 1 3647.dat",
  ].join("\n");
  const document = createEmptyDocument("Callout frame");
  document.imported = { version: 1, format: "io", sourceName: "test.io", sourceText: source,
    ...parseLDraw(source), resources: {}, legalDocuments: [] };
  const before = structuredClone(document.imported.instances);
  const ids = document.imported.instances.map(part => part.id);
  const step = { id: "callout", title: "", notes: "", partIds: ids };
  const isolated = studioCalloutStep(document, step, ids);
  const rotation = new Matrix4().makeRotationFromEuler(new Euler(
    ...isolated.rotation!.map(angle => angle * Math.PI / 180) as [number, number, number],
  ));
  const parentInViewer = new Matrix4().makeRotationX(-Math.PI / 2);
  const result = rotation.multiply(parentInViewer);
  result.elements.forEach((value, index) => expect(value).toBeCloseTo(new Matrix4().elements[index], 8));
  expect(document.imported.instances).toEqual(before);
  expect(studioCalloutStep(document, step, [])).toBe(step);
});
