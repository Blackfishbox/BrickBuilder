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
