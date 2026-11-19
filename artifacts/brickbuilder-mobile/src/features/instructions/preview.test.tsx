// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { PerspectiveCamera, Vector3 } from "three";
import { createEmptyDocument, type BuilderDocument } from "../editor/model";
import InstructionsPanel from "./InstructionsPanel";
import { updateInstructions } from "./model";
import {
  applyInstructionCameraRotation,
  DEFAULT_INSTRUCTION_PHI,
  DEFAULT_INSTRUCTION_THETA,
  instructionRotationFromCameraPose,
} from "../engine/instruction-camera";

const { preview } = vi.hoisted(() => ({ preview: vi.fn() }));
vi.mock("../engine/BuilderCanvas", () => ({ default: (props: unknown) => { preview(props); return null; } }));
vi.mock("./StudioLayoutEditor", () => ({ default: () => null }));
vi.mock("./StepPartsBox", () => ({ default: () => null }));

let root: ReturnType<typeof createRoot> | undefined;
let host: HTMLDivElement;
afterEach(() => {
  if (root) act(() => root!.unmount());
  host?.remove(); vi.unstubAllGlobals(); vi.clearAllMocks();
});

it("persists manual preview camera changes independently for each step", () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const source = createEmptyDocument();
  source.bricks = [{ id: "b", type: "brick-1x2", color: "#ff0000", x: 0, y: 0, z: 0, rotation: 0 }];
  source.instructions = { version: 1, edited: false, source: "manual", warnings: [], steps: [
    { id: "one", title: "One", notes: "", partIds: ["b"] }, { id: "two", title: "Two", notes: "", partIds: [] },
  ] };
  function Harness() {
    const [doc, setDoc] = useState(source);
    return <InstructionsPanel document={doc} onChange={plan => setDoc(d => updateInstructions(d, plan))}
      onClose={() => {}} onExportPDF={async () => {}} />;
  }
  host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
  act(() => root!.render(<Harness />));
  const saved = { theta: 1.4, phi: 0.8, distance: 12, target: [1, 2, 3], referenceDistance: 20, referenceTarget: [0, 0, 0] };
  act(() => preview.mock.lastCall![0].onViewCameraChange(saved));
  expect(preview.mock.lastCall![0].viewCamera).toEqual(saved);
  act(() => host.querySelector<HTMLButtonElement>('[data-testid="button-instructions-next"]')!.click());
  expect(preview.mock.lastCall![0].viewCamera).toBeUndefined();
  act(() => host.querySelector<HTMLButtonElement>('[data-testid="button-instructions-prev"]')!.click());
  expect(preview.mock.lastCall![0].viewCamera).toEqual(saved);
});

it("commits a focused angle edit to its original step before switching steps", () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const source = createEmptyDocument();
  source.bricks = [{ id: "b", type: "brick-1x2", color: "#ff0000", x: 0, y: 0, z: 0, rotation: 0 }];
  const nextStepCamera = {
    theta: 1.1, phi: 0.9, distance: 14, target: [2, 3, 4] as [number, number, number],
    referenceDistance: 22, referenceTarget: [0, 0, 0] as [number, number, number],
  };
  source.instructions = { version: 1, edited: true, source: "manual", warnings: [], steps: [
    { id: "one", title: "One", notes: "", partIds: ["b"], rotation: [0, 0, 0] },
    { id: "two", title: "Two", notes: "", partIds: [], rotation: [0, 60, 0], camera: nextStepCamera },
  ] };
  let savedDocument = source;
  function Harness() {
    const [doc, setDoc] = useState(source);
    return <InstructionsPanel document={doc} onChange={plan => setDoc(current => {
      const updated = updateInstructions(current, plan);
      savedDocument = updated;
      return updated;
    })} onClose={() => {}} onExportPDF={async () => {}} />;
  }
  host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
  act(() => root!.render(<Harness />));

  act(() => {
    const input = host.querySelector<HTMLInputElement>('[data-testid="input-instructions-rotation-x"]')!;
    input.focus();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "37");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  act(() => host.querySelector<HTMLButtonElement>('[data-testid="button-instructions-next"]')!.click());

  expect(preview.mock.lastCall![0].viewCamera).toEqual(nextStepCamera);
  expect(preview.mock.lastCall![0].viewRotation).toEqual([0, 60, 0]);
  expect(savedDocument.instructions?.steps[0].rotation).toEqual([37, 0, 0]);
  expect(savedDocument.instructions?.steps[1].rotation).toEqual([0, 60, 0]);

  act(() => host.querySelector<HTMLButtonElement>('[data-testid="button-instructions-prev"]')!.click());
  expect(host.querySelector<HTMLInputElement>('[data-testid="input-instructions-rotation-x"]')!.value).toBe("37");
  expect(preview.mock.lastCall![0].viewRotation).toEqual([37, 0, 0]);
});

it("commits a focused angle edit when Enter is pressed", () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const source = createEmptyDocument();
  source.bricks = [{ id: "b", type: "brick-1x2", color: "#ff0000", x: 0, y: 0, z: 0, rotation: 0 }];
  source.instructions = { version: 1, edited: true, source: "manual", warnings: [], steps: [
    { id: "one", title: "One", notes: "", partIds: ["b"], rotation: [0, 0, 0] },
  ] };
  let savedDocument = source;
  function Harness() {
    const [doc, setDoc] = useState(source);
    return <InstructionsPanel document={doc} onChange={plan => setDoc(current => {
      const updated = updateInstructions(current, plan);
      savedDocument = updated;
      return updated;
    })} onClose={() => {}} onExportPDF={async () => {}} />;
  }
  host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
  act(() => root!.render(<Harness />));

  act(() => {
    const input = host.querySelector<HTMLInputElement>('[data-testid="input-instructions-rotation-x"]')!;
    input.focus();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "37");
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  });

  expect(preview.mock.lastCall![0].viewRotation).toEqual([37, 0, 0]);
  expect(savedDocument.instructions?.steps[0].rotation).toEqual([37, 0, 0]);
  expect(host.querySelector<HTMLInputElement>('[data-testid="input-instructions-rotation-x"]')!.value).toBe("37");
});

it("shows touch rotations in the fields while zoom and pan leave the angles alone", () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const source = createEmptyDocument();
  source.bricks = [{ id: "b", type: "brick-1x2", color: "#ff0000", x: 0, y: 0, z: 0, rotation: 0 }];
  source.instructions = { version: 1, edited: true, source: "manual", warnings: [], steps: [
    { id: "one", title: "One", notes: "", partIds: ["b"], rotation: [0, 20, 0] },
  ] };
  function Harness() {
    const [doc, setDoc] = useState(source);
    return <InstructionsPanel document={doc} onChange={plan => setDoc(d => updateInstructions(d, plan))}
      onClose={() => {}} onExportPDF={async () => {}} />;
  }
  host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
  act(() => root!.render(<Harness />));
  const camera = {
    theta: DEFAULT_INSTRUCTION_THETA, phi: DEFAULT_INSTRUCTION_PHI, distance: 12,
    target: [1, 2, 3] as [number, number, number], referenceDistance: 20, referenceTarget: [0, 0, 0] as [number, number, number],
  };
  act(() => preview.mock.lastCall![0].onViewCameraChange(camera, [10, 20, 30]));
  expect(host.querySelector<HTMLInputElement>('[data-testid="input-instructions-rotation-x"]')!.value).toBe("10");
  expect(host.querySelector<HTMLInputElement>('[data-testid="input-instructions-rotation-y"]')!.value).toBe("20");
  expect(host.querySelector<HTMLInputElement>('[data-testid="input-instructions-rotation-z"]')!.value).toBe("30");
  act(() => preview.mock.lastCall![0].onViewCameraChange({ ...camera, target: [4, 5, 6] }, undefined));
  expect(host.querySelector<HTMLInputElement>('[data-testid="input-instructions-rotation-x"]')!.value).toBe("10");
  expect(preview.mock.lastCall![0].viewCamera.target).toEqual([4, 5, 6]);

  act(() => host.querySelector<HTMLButtonElement>('[data-testid="button-instructions-rotation-reset"]')!.click());
  expect(host.querySelector<HTMLInputElement>('[data-testid="input-instructions-rotation-x"]')!.value).toBe("0");
  expect(preview.mock.lastCall![0].viewCamera.theta).toBe(DEFAULT_INSTRUCTION_THETA);
  expect(preview.mock.lastCall![0].viewCamera.phi).toBe(DEFAULT_INSTRUCTION_PHI);
  expect(preview.mock.lastCall![0].viewCamera.distance).toBe(12);
  expect(preview.mock.lastCall![0].viewCamera.target).toEqual([4, 5, 6]);
});

it("edits and reopens a legacy combined camera without changing zoom, pan, or adding a rotation", () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const source = createEmptyDocument();
  source.bricks = [{ id: "b", type: "brick-1x2", color: "#ff0000", x: 0, y: 0, z: 0, rotation: 0 }];
  const legacyCamera = {
    theta: 1.2, phi: 0.8, distance: 10, target: [2, 3, 4] as [number, number, number],
    referenceDistance: 20, referenceTarget: [0, 0, 0] as [number, number, number],
  };
  const legacyRotation: [number, number, number] = [15, 25, -35];
  source.instructions = { version: 1, edited: true, source: "manual", warnings: [], steps: [
    { id: "legacy-step", title: "Legacy view", notes: "", partIds: ["b"], rotation: legacyRotation, camera: legacyCamera },
  ] };
  let savedDocument = source;
  function Harness({ document }: { document: BuilderDocument }) {
    const [currentDocument, setDocument] = useState(document);
    return <InstructionsPanel document={currentDocument} onChange={plan => {
      setDocument(current => {
        const updated = updateInstructions(current, plan);
        savedDocument = updated;
        return updated;
      });
    }} onClose={() => {}} onExportPDF={async () => {}} />;
  }
  host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
  act(() => root!.render(<Harness document={savedDocument} />));

  const pose = (theta: number, phi: number, rotation: readonly [number, number, number]) => {
    const camera = new PerspectiveCamera();
    const target = new Vector3();
    camera.position.set(Math.sin(phi) * Math.sin(theta), Math.cos(phi), Math.sin(phi) * Math.cos(theta));
    camera.lookAt(target);
    applyInstructionCameraRotation(camera, target, rotation);
    return camera;
  };
  const initiallyDisplayed = instructionRotationFromCameraPose(
    legacyCamera.theta, legacyCamera.phi, legacyRotation,
  );
  const initialProps = preview.mock.lastCall![0];
  expect(initialProps.viewCamera).toEqual(legacyCamera);
  expect(initialProps.viewRotation).toEqual(legacyRotation);
  expect(host.querySelector<HTMLInputElement>('[data-testid="input-instructions-rotation-x"]')!.value)
    .toBe(String(initiallyDisplayed[0]));
  expect(pose(legacyCamera.theta, legacyCamera.phi, legacyRotation).quaternion.angleTo(
    pose(DEFAULT_INSTRUCTION_THETA, DEFAULT_INSTRUCTION_PHI, initiallyDisplayed).quaternion,
  )).toBeLessThan(0.00001);

  const editedRotation = [...initiallyDisplayed] as [number, number, number];
  editedRotation[0] += 12;
  act(() => {
    const input = host.querySelector<HTMLInputElement>('[data-testid="input-instructions-rotation-x"]')!;
    input.value = String(editedRotation[0]);
    input.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
  });

  const editedProps = preview.mock.lastCall![0];
  expect(editedProps.viewRotation).toEqual(editedRotation);
  expect(editedProps.viewCamera).toEqual({
    ...legacyCamera, theta: DEFAULT_INSTRUCTION_THETA, phi: DEFAULT_INSTRUCTION_PHI,
  });
  expect(editedProps.viewCamera.distance).toBe(legacyCamera.distance);
  expect(editedProps.viewCamera.target).toEqual(legacyCamera.target);
  const intendedPose = pose(DEFAULT_INSTRUCTION_THETA, DEFAULT_INSTRUCTION_PHI, editedRotation);
  expect(pose(
    editedProps.viewCamera.theta, editedProps.viewCamera.phi, editedProps.viewRotation,
  ).quaternion.angleTo(intendedPose.quaternion)).toBeLessThan(0.00001);

  savedDocument = JSON.parse(JSON.stringify(savedDocument)) as BuilderDocument;
  expect(savedDocument.instructions?.steps[0].rotation).toEqual(editedRotation);
  expect(savedDocument.instructions?.steps[0].camera).toEqual(editedProps.viewCamera);

  act(() => root!.unmount());
  root = createRoot(host);
  act(() => root!.render(<Harness document={savedDocument} />));
  const reopenedProps = preview.mock.lastCall![0];
  expect(reopenedProps.viewRotation).toEqual(editedRotation);
  expect(reopenedProps.viewCamera).toEqual(editedProps.viewCamera);
  expect(host.querySelector<HTMLInputElement>('[data-testid="input-instructions-rotation-x"]')!.value)
    .toBe(String(editedRotation[0]));
  expect(pose(
    reopenedProps.viewCamera.theta, reopenedProps.viewCamera.phi, reopenedProps.viewRotation,
  ).quaternion.angleTo(intendedPose.quaternion)).toBeLessThan(0.00001);
});

it("keeps the displayed angles in sync with repeated multi-turn camera updates", () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const source = createEmptyDocument();
  source.bricks = [{ id: "b", type: "brick-1x2", color: "#ff0000", x: 0, y: 0, z: 0, rotation: 0 }];
  source.instructions = { version: 1, edited: true, source: "manual", warnings: [], steps: [
    { id: "one", title: "One", notes: "", partIds: ["b"] },
  ] };
  function Harness() {
    const [doc, setDoc] = useState(source);
    return <InstructionsPanel document={doc} onChange={plan => setDoc(d => updateInstructions(d, plan))}
      onClose={() => {}} onExportPDF={async () => {}} />;
  }
  host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
  act(() => root!.render(<Harness />));

  let rotation: [number, number, number] | undefined;
  const camera = {
    theta: DEFAULT_INSTRUCTION_THETA, phi: DEFAULT_INSTRUCTION_PHI, distance: 12,
    target: [1, 2, 3] as [number, number, number], referenceDistance: 20, referenceTarget: [0, 0, 0] as [number, number, number],
  };
  for (let gesture = 0; gesture < 24; gesture++) {
    const phi = gesture % 2 === 0 ? 0.25 : 1.42;
    rotation = instructionRotationFromCameraPose(
      DEFAULT_INSTRUCTION_THETA + Math.PI * 2 + 0.12,
      phi,
      rotation,
    );
    act(() => preview.mock.lastCall![0].onViewCameraChange(camera, rotation));
    const displayedRotation = instructionRotationFromCameraPose(
      camera.theta,
      camera.phi,
      rotation,
    );

    for (const axis of ["x", "y", "z"] as const) {
      expect(host.querySelector<HTMLInputElement>(`[data-testid="input-instructions-rotation-${axis}"]`)!.value)
        .toBe(String(displayedRotation[axis === "x" ? 0 : axis === "y" ? 1 : 2]));
    }
    expect(preview.mock.lastCall![0].viewCamera.distance).toBe(12);
    expect(preview.mock.lastCall![0].viewCamera.target).toEqual([1, 2, 3]);
  }
});

it("passes each saved step rotation to the live view and updates on edit/reset without changing model parts", () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const source = createEmptyDocument();
  source.bricks = [{ id: "brick", type: "brick-1x2", color: "#ff0000", x: 3, y: 0, z: 2, rotation: 0 }];
  source.instructions = { version: 1, source: "manual", edited: true, warnings: [], steps: [
    { id: "one", title: "One", notes: "", partIds: ["brick"], rotation: [0, 90, 0] },
    { id: "two", title: "Two", notes: "", partIds: [], rotation: [0, 0, 45] },
  ] };
  const original = structuredClone(source);
  function Harness() {
    const [document, setDocument] = useState<BuilderDocument>(source);
    return <InstructionsPanel document={document} onChange={plan => setDocument(doc => updateInstructions(doc, plan))}
      onClose={() => {}} onExportPDF={async () => {}} />;
  }
  host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
  act(() => root!.render(<Harness />));
  const rotation = () => preview.mock.lastCall![0].viewRotation;
  expect(rotation()).toEqual([0, 90, 0]);
  act(() => host.querySelector<HTMLButtonElement>('[data-testid="button-instructions-next"]')!.click());
  expect(rotation()).toEqual([0, 0, 45]);
  act(() => {
    const input = host.querySelector<HTMLInputElement>('[data-testid="input-instructions-rotation-x"]')!;
    input.value = "30"; input.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
  });
  expect(rotation()).toEqual([30, 0, 45]);
  act(() => host.querySelector<HTMLButtonElement>('[data-testid="button-instructions-rotation-reset"]')!.click());
  expect(rotation()).toBeUndefined();
  act(() => host.querySelector<HTMLButtonElement>('[data-testid="button-instructions-prev"]')!.click());
  expect(rotation()).toEqual([0, 90, 0]);
  expect(source).toEqual(original);
});

it("toggles occurrence highlighting across cumulative, empty and previous steps without editing the document", () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const source = createEmptyDocument();
  source.bricks = ["old", "new"].map(id => ({ id, type: "brick-1x2", color: "#ff0000", x: 0, y: 0, z: 0, rotation: 0 }));
  source.instructions = { version: 1, source: "manual", edited: true, warnings: [], steps: [
    { id: "one", title: "One", notes: "", partIds: ["old"] },
    { id: "two", title: "Two", notes: "", partIds: ["new"] },
    { id: "empty", title: "Empty", notes: "", partIds: [] },
  ] };
  const original = structuredClone(source), onChange = vi.fn();
  host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
  act(() => root!.render(<InstructionsPanel document={source} onChange={onChange} onClose={() => {}} onExportPDF={async () => {}} />));
  const props = () => preview.mock.lastCall![0];
  const click = (id: string) => act(() => host.querySelector<HTMLButtonElement>(`[data-testid="button-instructions-${id}"]`)!.click());
  expect(props().instructionFocusIds).toBeUndefined();
  click("highlight");
  expect(host.querySelector('[data-testid="button-instructions-highlight"]')!.getAttribute("aria-pressed")).toBe("true");
  expect(props().instructionFocusIds).toBeUndefined();
  expect(host.querySelector('[data-testid="text-instructions-highlight-legend"]')).toBeNull();
  click("next");
  expect(props().bricks.map((b: { id: string }) => b.id)).toEqual(["old", "new"]);
  expect(props().instructionFocusIds).toEqual(new Set(["new"]));
  click("next");
  expect(props().instructionFocusIds).toEqual(new Set());
  expect(props().bricks).toHaveLength(2);
  click("prev");
  expect(props().instructionFocusIds).toEqual(new Set(["new"]));
  click("highlight");
  expect(props().instructionFocusIds).toBeUndefined();
  expect(onChange).not.toHaveBeenCalled();
  expect(source).toEqual(original);
});

it("passes the enabled highlight option to PDF export", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const source = createEmptyDocument();
  source.bricks = [{ id: "new", type: "brick-1x2", color: "#ff0000", x: 0, y: 0, z: 0, rotation: 0 }];
  source.instructions = { version: 1, source: "manual", edited: true, warnings: [], steps: [
    { id: "one", title: "One", notes: "", partIds: ["new"] },
  ] };
  const onExportPDF = vi.fn(async () => {});
  host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
  act(() => root!.render(<InstructionsPanel document={source} onChange={() => {}} onClose={() => {}} onExportPDF={onExportPDF} />));
  act(() => host.querySelector<HTMLButtonElement>('[data-testid="button-instructions-highlight"]')!.click());
  await act(async () => {
    host.querySelector<HTMLButtonElement>('[data-testid="button-instructions-export-pdf"]')!.click();
    await new Promise(resolve => setTimeout(resolve, 0));
  });
  expect(onExportPDF).toHaveBeenCalledOnce();
  expect(onExportPDF.mock.calls[0][3]).toBe(true);
});

it("saves a focused angle edit before passing the plan to PDF export", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const source = createEmptyDocument();
  source.bricks = [{ id: "b", type: "brick-1x2", color: "#ff0000", x: 0, y: 0, z: 0, rotation: 0 }];
  source.instructions = { version: 1, source: "manual", edited: false, warnings: [], steps: [
    { id: "one", title: "One", notes: "", partIds: ["b"], rotation: [0, 0, 0] },
  ] };
  let savedDocument = source;
  const onExportPDF = vi.fn(async () => {});
  function Harness() {
    const [doc, setDoc] = useState(source);
    return <InstructionsPanel document={doc} onChange={plan => setDoc(current => {
      const updated = updateInstructions(current, plan);
      savedDocument = updated;
      return updated;
    })} onClose={() => {}} onExportPDF={onExportPDF} />;
  }
  host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
  act(() => root!.render(<Harness />));

  await act(async () => {
    const input = host.querySelector<HTMLInputElement>('[data-testid="input-instructions-rotation-x"]')!;
    input.focus();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "37");
    input.dispatchEvent(new Event("input", { bubbles: true }));
    host.querySelector<HTMLButtonElement>('[data-testid="button-instructions-export-pdf"]')!.click();
    await new Promise(resolve => setTimeout(resolve, 0));
  });

  expect(savedDocument.instructions?.steps[0].rotation).toEqual([37, 0, 0]);
  expect(onExportPDF).toHaveBeenCalledOnce();
  expect(onExportPDF.mock.calls[0][0].steps[0].rotation).toEqual([37, 0, 0]);
});
