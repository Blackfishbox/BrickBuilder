// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { createEmptyDocument, type BuilderDocument } from "../editor/model";
import InstructionsPanel from "./InstructionsPanel";
import { updateInstructions } from "./model";

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
