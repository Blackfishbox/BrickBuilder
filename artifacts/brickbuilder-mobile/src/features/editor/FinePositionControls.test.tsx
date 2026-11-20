// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import FinePositionControls from "./FinePositionControls";

it("exposes six touch adjustments of exactly one LDU in world coordinates", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div"), root = createRoot(container), onNudge = vi.fn();
  try {
    await act(async () => root.render(<FinePositionControls onNudge={onNudge} />));
    expect(container.querySelector("summary")?.getAttribute("aria-label")).toBe("Feinjustierung öffnen");
    const buttons = container.querySelectorAll("button");
    expect(buttons).toHaveLength(6);
    expect([...buttons].every(button => !button.textContent?.trim() && button.querySelector("svg"))).toBe(true);
    await act(async () => { buttons.forEach(button => button.click()); });
    expect(onNudge.mock.calls.map(([delta]) => delta)).toEqual([
      { x: -0.05, y: 0, z: 0 }, { x: 0.05, y: 0, z: 0 },
      { x: 0, y: 0, z: -0.05 }, { x: 0, y: 0, z: 0.05 },
      { x: 0, y: 0.05, z: 0 }, { x: 0, y: -0.05, z: 0 },
    ]);
  } finally { await act(async () => root.unmount()); vi.unstubAllGlobals(); }
});

it("opens the fine-adjustment panel when its summary is tapped", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div"), root = createRoot(container), onOpenChange = vi.fn();
  try {
    await act(async () => root.render(<FinePositionControls onNudge={vi.fn()} onOpenChange={onOpenChange} />));
    const details = container.querySelector("details");
    expect(details?.open).toBe(false);
    await act(async () => container.querySelector("summary")?.click());
    expect(details?.open).toBe(true);
    expect(onOpenChange).toHaveBeenLastCalledWith(true);
    expect(container.querySelectorAll(".fine-position-grid button")).toHaveLength(6);
    await act(async () => container.querySelector("summary")?.click());
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
  } finally { await act(async () => root.unmount()); vi.unstubAllGlobals(); }
});
