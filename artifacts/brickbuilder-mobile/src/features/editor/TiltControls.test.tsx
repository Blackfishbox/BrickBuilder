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

it("exposes independent free X and Z angle fields and commits decimal degrees", () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const onTilt = vi.fn();
  host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
  act(() => root!.render(<TiltControls tiltX={0} tiltZ={0} onTilt={onTilt} />));

  act(() => {
    const x = host!.querySelector<HTMLInputElement>('[data-testid="input-tilt-x"]')!;
    x.value = "27,5";
    x.dispatchEvent(new Event("input", { bubbles: true }));
    x.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    const z = host!.querySelector<HTMLInputElement>('[data-testid="input-tilt-z"]')!;
    z.value = "-12";
    z.dispatchEvent(new Event("input", { bubbles: true }));
    z.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
  });
  expect(onTilt.mock.calls).toEqual([["x", 27.5], ["z", -12]]);
  expect(host.querySelector('[aria-label="Neigung einstellen"]')).toBeTruthy();
});

it("updates either axis from its touch-friendly slider and displays the current values", () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const onTilt = vi.fn();
  host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
  act(() => root!.render(<TiltControls tiltX={12} tiltZ={-24} onTilt={onTilt} />));

  act(() => {
    const x = host!.querySelector<HTMLInputElement>('[data-testid="slider-tilt-x"]')!;
    setInputValue(x, "48");
    const z = host!.querySelector<HTMLInputElement>('[data-testid="slider-tilt-z"]')!;
    setInputValue(z, "-36");
  });
  expect(onTilt.mock.calls).toEqual([["x", 48], ["z", -36]]);
  expect(host.querySelector('[data-testid="value-tilt-x"]')?.textContent).toBe("12°");
  expect(host.querySelector('[data-testid="value-tilt-z"]')?.textContent).toBe("-24°");

  act(() => root!.render(<TiltControls tiltX={48} tiltZ={-36} onTilt={onTilt} />));
  expect(host.querySelector<HTMLInputElement>('[data-testid="input-tilt-x"]')?.value).toBe("48");
  expect(host.querySelector<HTMLInputElement>('[data-testid="input-tilt-z"]')?.value).toBe("-36");
  expect(host.querySelector('[data-testid="value-tilt-x"]')?.textContent).toBe("48°");
  expect(host.querySelector('[data-testid="value-tilt-z"]')?.textContent).toBe("-36°");
});

it("keeps an active numeric draft when the other axis changes externally", () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const onTilt = vi.fn();
  host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
  act(() => root!.render(<TiltControls tiltX={0} tiltZ={0} onTilt={onTilt} />));

  act(() => {
    const x = host!.querySelector<HTMLInputElement>('[data-testid="input-tilt-x"]')!;
    x.focus();
    setInputValue(x, "27,5");
  });
  act(() => root!.render(<TiltControls tiltX={0} tiltZ={30} onTilt={onTilt} />));
  expect(host.querySelector<HTMLInputElement>('[data-testid="input-tilt-x"]')?.value).toBe("27,5");
  expect(host.querySelector<HTMLInputElement>('[data-testid="input-tilt-z"]')?.value).toBe("30");
  expect(host.querySelector('[data-testid="value-tilt-z"]')?.textContent).toBe("30°");
});

it("commits an active field before the same axis is adjusted with the slider", () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const onTilt = vi.fn();
  host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
  act(() => root!.render(<TiltControls tiltX={0} tiltZ={0} onTilt={onTilt} />));

  act(() => {
    const x = host!.querySelector<HTMLInputElement>('[data-testid="input-tilt-x"]')!;
    x.focus();
    setInputValue(x, "20,5");
    const slider = host!.querySelector<HTMLInputElement>('[data-testid="slider-tilt-x"]')!;
    slider.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    setInputValue(slider, "-12");
  });
  expect(onTilt.mock.calls).toEqual([["x", 20.5], ["x", -12]]);
});
