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
    expect(container.querySelector('[data-testid="button-fine-adjustment"]')?.getAttribute("aria-label")).toBe("Feinjustierung öffnen");
    const buttons = container.querySelectorAll(".fine-position-grid button");
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

it("opens and closes the fine-adjustment panel with its explicit toggle", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div"), root = createRoot(container), onOpenChange = vi.fn();
  try {
    await act(async () => root.render(<FinePositionControls onNudge={vi.fn()} onOpenChange={onOpenChange} />));
    const menu = container.querySelector<HTMLElement>('[data-testid="fine-position-menu"]')!;
    const toggle = container.querySelector<HTMLButtonElement>('[data-testid="button-fine-adjustment"]')!;
    expect(menu.dataset.open).toBe("false");
    await act(async () => toggle.click());
    expect(menu.dataset.open).toBe("true");
    expect(onOpenChange).toHaveBeenLastCalledWith(true);
    expect(container.querySelectorAll(".fine-position-grid button")).toHaveLength(6);
    await act(async () => toggle.click());
    expect(menu.dataset.open).toBe("false");
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
  } finally { await act(async () => root.unmount()); vi.unstubAllGlobals(); }
});
