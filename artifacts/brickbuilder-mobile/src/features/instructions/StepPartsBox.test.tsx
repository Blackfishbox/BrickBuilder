// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { createEmptyDocument } from "../editor/model";
import StepPartsBox from "./StepPartsBox";

const { image } = vi.hoisted(() => ({ image: vi.fn(async () => "data:image/jpeg;base64,thumbnail") }));
vi.mock("./part-images", () => ({ instructionPartImage: image }));
vi.mock("../parts/thumbnails/visibility", () => ({ observeThumbnail: (_: Element, notify: (value: boolean) => void) => { notify(true); return () => {}; } }));
let root: ReturnType<typeof createRoot>, host: HTMLDivElement;
afterEach(() => { if (root) act(() => root.unmount()); host?.remove(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

it("shows only this step's shapes, colors and quantities, refreshes on step change, and explains empty steps", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("IntersectionObserver", class {});
  const doc = createEmptyDocument();
  doc.bricks = [
    { id: "one", type: "brick-1x2", color: "#ff0000", x: 0, y: 0, z: 0, rotation: 0 },
    { id: "two", type: "brick-1x2", color: "#ff0000", x: 2, y: 0, z: 0, rotation: 0 },
    { id: "three", type: "brick-2x4", color: "#0000ff", x: 4, y: 0, z: 0, rotation: 0 },
  ];
  host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
  await act(async () => root.render(<StepPartsBox document={doc} partIds={["one", "two"]} />));
  expect(host.querySelectorAll("li")).toHaveLength(1);
  expect(host.querySelector("li")?.getAttribute("aria-label")).toBe("2 × LDraw 3004 · #ff0000");
  expect(host.querySelector("img")?.alt).toBe("LDraw 3004 · #ff0000");
  expect(host.querySelector("img")?.src).toContain("data:image/jpeg");
  await act(async () => root.render(<StepPartsBox document={doc} partIds={["three"]} />));
  expect(host.querySelector("img")?.alt).toBe("LDraw 3001 · #0000ff");
  expect(host.textContent).not.toContain("3004");
  await act(async () => root.render(<StepPartsBox document={doc} partIds={[]} />));
  expect(host.querySelectorAll("img")).toHaveLength(0);
  expect(host.textContent).toContain("Keine neuen Teile");
});

it("offers explicit loading on old WebViews instead of an endless spinner or eager rendering", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); vi.stubGlobal("IntersectionObserver", undefined);
  const doc = createEmptyDocument();
  doc.bricks = [{ id: "one", type: "brick-1x2", color: "#ff0000", x: 0, y: 0, z: 0, rotation: 0 }];
  host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
  await act(async () => root.render(<StepPartsBox document={doc} partIds={["one"]} />));
  expect(image).not.toHaveBeenCalled();
  await act(async () => host.querySelector<HTMLButtonElement>("button")!.click());
  expect(host.querySelector("img")?.alt).toBe("LDraw 3004 · #ff0000");
});
