// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import TiltControls from "./TiltControls";

let root: ReturnType<typeof createRoot> | undefined;
let host: HTMLDivElement | undefined;
function setInputValue(input: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}
afterEach(() => {
  if (root) act(() => root!.unmount());
  host?.remove(); root = undefined; host = undefined; vi.unstubAllGlobals(); vi.clearAllMocks();
});

it("exposes independent X and Z angle fields and commits whole degrees", () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const onTilt = vi.fn();
  host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
  act(() => root!.render(<TiltControls tiltX={0} tiltZ={0} onTilt={onTilt} />));

  act(() => {
    const x = host!.querySelector<HTMLInputElement>('[data-testid="input-tilt-x"]')!;
    x.value = "27";
    x.dispatchEvent(new Event("input", { bubbles: true }));
    x.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    const z = host!.querySelector<HTMLInputElement>('[data-testid="input-tilt-z"]')!;
    z.value = "-12";
    z.dispatchEvent(new Event("input", { bubbles: true }));
    z.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
  });
  expect(onTilt.mock.calls).toEqual([["x", 27], ["z", -12]]);
  expect(host.querySelector('[aria-label="Drehung und Neigung einstellen"]')).toBeTruthy();
});

it("updates either tilt axis from its slider and displays whole-degree values", () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const onTilt = vi.fn();
  host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
  act(() => root!.render(<TiltControls tiltX={12} tiltZ={-24} onTilt={onTilt} />));

  act(() => {
    setInputValue(host!.querySelector<HTMLInputElement>('[data-testid="slider-tilt-x"]')!, "48");
    setInputValue(host!.querySelector<HTMLInputElement>('[data-testid="slider-tilt-z"]')!, "-36");
  });
  expect(onTilt.mock.calls).toEqual([["x", 48], ["z", -36]]);
  act(() => root!.render(<TiltControls tiltX={48} tiltZ={-36} onTilt={onTilt} />));
  expect(host.querySelector('[data-testid="value-tilt-x"]')?.textContent).toBe("48°");
  expect(host.querySelector('[data-testid="value-tilt-z"]')?.textContent).toBe("-36°");
});

it("preserves an active numeric draft when the other axis changes", () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const onTilt = vi.fn();
  host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
  act(() => root!.render(<TiltControls tiltX={0} tiltZ={0} onTilt={onTilt} />));

  act(() => {
    const x = host!.querySelector<HTMLInputElement>('[data-testid="input-tilt-x"]')!;
    x.focus();
    setInputValue(x, "27");
  });
  act(() => root!.render(<TiltControls tiltX={0} tiltZ={30} onTilt={onTilt} />));
  expect(host.querySelector<HTMLInputElement>('[data-testid="input-tilt-x"]')?.value).toBe("27");
  expect(host.querySelector<HTMLInputElement>('[data-testid="input-tilt-z"]')?.value).toBe("30");
});

it("commits an active tilt value before the slider changes that same axis", () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const onTilt = vi.fn();
  host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
  act(() => root!.render(<TiltControls tiltX={0} tiltZ={0} onTilt={onTilt} />));

  act(() => {
    const x = host!.querySelector<HTMLInputElement>('[data-testid="input-tilt-x"]')!;
    x.focus();
    setInputValue(x, "20");
    const slider = host!.querySelector<HTMLInputElement>('[data-testid="slider-tilt-x"]')!;
    slider.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    setInputValue(slider, "-12");
  });
  expect(onTilt.mock.calls).toEqual([["x", 20], ["x", -12]]);
});

it("supports free Y rotation from 0 to 360 degrees using whole degrees", () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const onRotate = vi.fn();
  const onTilt = vi.fn();
  host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
  act(() => root!.render(<TiltControls rotationY={90} tiltX={12} tiltZ={-24} onRotate={onRotate} onTilt={onTilt} />));

  const slider = host.querySelector<HTMLInputElement>('[data-testid="slider-rotation-y"]')!;
  expect(slider.min).toBe("0");
  expect(slider.max).toBe("360");
  expect(slider.step).toBe("1");
  expect(host.querySelector('[data-testid="value-rotation-y"]')?.textContent).toBe("90°");
  expect(host.textContent).not.toContain("Hochachse");

  act(() => setInputValue(slider, "137.5"));
  expect(onRotate.mock.calls.every(([angle]) => Number.isInteger(angle))).toBe(true);
  expect(onRotate).toHaveBeenLastCalledWith(138);
  act(() => root!.render(<TiltControls rotationY={137.5} tiltX={12} tiltZ={-24} onRotate={onRotate} onTilt={onTilt} />));
  expect(host.querySelector<HTMLInputElement>('[data-testid="input-rotation-y"]')?.value).toBe("138");
  expect(host.querySelector('[data-testid="value-rotation-y"]')?.textContent).toBe("138°");

  act(() => {
    const input = host!.querySelector<HTMLInputElement>('[data-testid="input-rotation-y"]')!;
    input.focus();
    setInputValue(input, "138.5");
    input.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
  });
  expect(onRotate).toHaveBeenLastCalledWith(138);
  act(() => {
    const input = host!.querySelector<HTMLInputElement>('[data-testid="input-rotation-y"]')!;
    input.focus();
    setInputValue(input, "361");
    input.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
  });
  expect(onRotate).toHaveBeenLastCalledWith(360);
  expect(onTilt).not.toHaveBeenCalled();
});

it("rejects fractional tilt input and rounds legacy values for display", () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const onTilt = vi.fn();
  host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
  act(() => root!.render(<TiltControls tiltX={27.5} tiltZ={-12.4} onTilt={onTilt} />));
  expect(host.querySelector<HTMLInputElement>('[data-testid="input-tilt-x"]')?.value).toBe("28");
  expect(host.querySelector<HTMLInputElement>('[data-testid="input-tilt-z"]')?.value).toBe("-12");
  act(() => {
    const x = host!.querySelector<HTMLInputElement>('[data-testid="input-tilt-x"]')!;
    x.focus();
    setInputValue(x, "28.5");
    x.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    const z = host!.querySelector<HTMLInputElement>('[data-testid="input-tilt-z"]')!;
    z.focus();
    setInputValue(z, "-12.5");
    z.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
  });
  expect(onTilt.mock.calls.every(([, angle]) => Number.isInteger(angle))).toBe(true);
});
