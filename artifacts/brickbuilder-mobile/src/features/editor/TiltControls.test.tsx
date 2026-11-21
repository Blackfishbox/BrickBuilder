// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import TiltControls from "./TiltControls";
import type { RotationAnchor } from "@/features/connections/rotation-anchors";

let root: ReturnType<typeof createRoot> | undefined;
let host: HTMLDivElement | undefined;
function setInputValue(input: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}
function dispatchTouchPointer(element: HTMLInputElement, type: string, x = 10, y = 10) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(event, {
    pointerType: { value: "touch" },
    clientX: { value: x },
    clientY: { value: y },
  });
  element.dispatchEvent(event);
}
function tap(element: HTMLInputElement, x = 10, y = 10) {
  dispatchTouchPointer(element, "pointerdown", x, y);
  dispatchTouchPointer(element, "pointerup", x, y);
}
afterEach(() => {
  if (root) act(() => root!.unmount());
  host?.remove(); root = undefined; host = undefined; vi.unstubAllGlobals(); vi.clearAllMocks();
});

it("shows only three whole-degree sliders for rotation and tilt", () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
  act(() => root!.render(<TiltControls rotationY={90} tiltX={12} tiltZ={-24} onRotate={vi.fn()} onTilt={vi.fn()} />));

  expect(host.querySelectorAll('input[type="range"]')).toHaveLength(3);
  expect(host.querySelectorAll('input:not([type="range"])')).toHaveLength(0);
  expect(host.querySelector('[data-testid="slider-rotation-y"]')?.getAttribute("step")).toBe("1");
  expect(host.querySelector('[data-testid="slider-tilt-x"]')?.getAttribute("step")).toBe("1");
  expect(host.querySelector('[data-testid="slider-tilt-z"]')?.getAttribute("step")).toBe("1");
  expect(host.querySelector('[data-testid="value-rotation-y"]')?.textContent).toBe("90°");
  expect(host.querySelector('[data-testid="value-tilt-x"]')?.textContent).toBe("12°");
  expect(host.querySelector('[data-testid="value-tilt-z"]')?.textContent).toBe("-24°");
  expect(host.querySelector('[aria-label="Drehung und Neigung einstellen"]')).toBeTruthy();
  expect(host.querySelector('[aria-label="Drehung und Neigung einstellen"]')?.textContent?.trim()).toBe("");
});

it("uses only supplied anchors and reports an explicit origin fallback", () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const anchor: RotationAnchor = {
    id: "0,-0.823,-9.895", position: [0, -0.82275, -9.8951], family: "clip",
    evidencePath: "parts/3820.dat", evidenceLine: 12,
  };
  const onPivotChange = vi.fn();
  host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
  act(() => root!.render(<TiltControls tiltX={0} tiltZ={0} onTilt={vi.fn()} anchors={[anchor]}
    onPivotChange={onPivotChange} rotationPivot={null} />));

  const select = host.querySelector<HTMLSelectElement>('[data-testid="select-rotation-anchor"]')!;
  expect([...select.options].map(option => option.value)).toEqual(["origin", anchor.id]);
  act(() => {
    select.value = anchor.id;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(onPivotChange).toHaveBeenCalledWith(anchor.position);
});

it("keeps the open rotation panel inside the viewport while dragging its handle", () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("innerWidth", 320);
  vi.stubGlobal("innerHeight", 240);
  host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
  act(() => root!.render(<TiltControls open tiltX={0} tiltZ={0} onTilt={vi.fn()} />));
  const panel = host.querySelector<HTMLElement>(".tilt-panel")!;
  vi.spyOn(panel, "getBoundingClientRect").mockReturnValue({
    x: 24, y: 20, left: 24, top: 20, right: 294, bottom: 228, width: 270, height: 208, toJSON: () => ({}),
  });
  const handle = host.querySelector<HTMLButtonElement>('[data-testid="button-move-tilt-panel"]')!;
  const dispatch = (type: string, x: number, y: number) => {
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.defineProperties(event, { pointerId: { value: 1 }, clientX: { value: x }, clientY: { value: y } });
    (type === "pointerdown" ? handle : window).dispatchEvent(event);
  };
  act(() => {
    dispatch("pointerdown", 120, 100);
    dispatch("pointermove", 700, 700);
    dispatch("pointerup", 700, 700);
  });

  const left = Number.parseFloat(panel.style.left), top = Number.parseFloat(panel.style.top);
  expect(left).toBeGreaterThanOrEqual(8);
  expect(left + 270).toBeLessThanOrEqual(312);
  expect(top).toBeGreaterThanOrEqual(8);
  expect(top + 208).toBeLessThanOrEqual(232);
});

it("sends slider changes as whole-degree values", () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const onRotate = vi.fn(), onTilt = vi.fn();
  host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
  act(() => root!.render(<TiltControls onRotate={onRotate} tiltX={0} tiltZ={0} onTilt={onTilt} />));

  act(() => {
    setInputValue(host!.querySelector<HTMLInputElement>('[data-testid="slider-rotation-y"]')!, "137.5");
    setInputValue(host!.querySelector<HTMLInputElement>('[data-testid="slider-tilt-x"]')!, "48.5");
    setInputValue(host!.querySelector<HTMLInputElement>('[data-testid="slider-tilt-z"]')!, "-36.5");
  });
  expect(onRotate).toHaveBeenLastCalledWith(138);
  expect(onTilt.mock.calls).toEqual([["x", 49], ["z", -36]]);
});

it("brackets Y-rotation pointer gestures so the editor can save them as one history step", () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const onRotateStart = vi.fn(), onRotateEnd = vi.fn();
  host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
  act(() => root!.render(<TiltControls tiltX={0} tiltZ={0} onRotateStart={onRotateStart} onRotateEnd={onRotateEnd} onTilt={vi.fn()} />));

  const ySlider = host.querySelector<HTMLInputElement>('[data-testid="slider-rotation-y"]')!;
  const xSlider = host.querySelector<HTMLInputElement>('[data-testid="slider-tilt-x"]')!;
  act(() => {
    dispatchTouchPointer(ySlider, "pointerdown");
    dispatchTouchPointer(ySlider, "pointerup");
    dispatchTouchPointer(xSlider, "pointerdown");
    dispatchTouchPointer(xSlider, "pointerup");
  });
  expect(onRotateStart).toHaveBeenCalledTimes(1);
  expect(onRotateEnd).toHaveBeenCalledTimes(1);
});

it("resets the double-tapped rotation or tilt slider without affecting the others", () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const onRotate = vi.fn(), onTilt = vi.fn();
  host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
  act(() => root!.render(<TiltControls rotationY={90} tiltX={28} tiltZ={-14} onRotate={onRotate} onTilt={onTilt} />));

  const ySlider = host.querySelector<HTMLInputElement>('[data-testid="slider-rotation-y"]')!;
  const xSlider = host.querySelector<HTMLInputElement>('[data-testid="slider-tilt-x"]')!;
  const zSlider = host.querySelector<HTMLInputElement>('[data-testid="slider-tilt-z"]')!;
  act(() => { tap(ySlider); tap(ySlider); });
  expect(onRotate).toHaveBeenCalledTimes(1);
  expect(onRotate).toHaveBeenLastCalledWith(0);
  expect(onTilt).not.toHaveBeenCalled();
  act(() => { tap(xSlider); tap(xSlider); });
  act(() => { tap(zSlider); tap(zSlider); });
  expect(onTilt.mock.calls).toEqual([["x", 0], ["z", 0]]);
});

it("resets the Y rotation on desktop double click too", () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const onRotate = vi.fn(), onTilt = vi.fn();
  host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
  act(() => root!.render(<TiltControls rotationY={180} tiltX={20} tiltZ={0} onRotate={onRotate} onTilt={onTilt} />));

  act(() => {
    host!.querySelector<HTMLInputElement>('[data-testid="slider-rotation-y"]')!
      .dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true, detail: 2 }));
  });
  expect(onRotate).toHaveBeenCalledWith(0);
  expect(onTilt).not.toHaveBeenCalled();
});

it("does not interpret a slider drag as a double tap", () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const onTilt = vi.fn();
  host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
  act(() => root!.render(<TiltControls tiltX={30} tiltZ={0} onTilt={onTilt} />));

  const slider = host.querySelector<HTMLInputElement>('[data-testid="slider-tilt-x"]')!;
  act(() => { tap(slider); });
  act(() => {
    dispatchTouchPointer(slider, "pointerdown", 10, 10);
    dispatchTouchPointer(slider, "pointermove", 40, 10);
    dispatchTouchPointer(slider, "pointerup", 40, 10);
  });
  act(() => { tap(slider); });
  expect(onTilt).not.toHaveBeenCalled();
});
