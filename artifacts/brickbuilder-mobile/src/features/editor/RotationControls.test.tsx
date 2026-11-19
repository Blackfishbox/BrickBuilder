// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import RotationControls from "./RotationControls";

let root: ReturnType<typeof createRoot> | undefined;
let host: HTMLDivElement | undefined;
function setInputValue(input: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}
afterEach(() => {
  if (root) act(() => root!.unmount());
  host?.remove(); root = undefined; host = undefined; vi.unstubAllGlobals();
});

it("accepts only whole degrees from the slider and numeric field", () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const onChange = vi.fn();
  host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
  act(() => root!.render(<RotationControls rotation={37.5} onChange={onChange} />));

  const slider = host.querySelector<HTMLInputElement>('[data-testid="slider-rotation"]')!;
  const input = host.querySelector<HTMLInputElement>('[data-testid="input-rotation"]')!;
  expect(slider.step).toBe("1");
  expect(slider.value).toBe("38");
  expect(input.value).toBe("38");
  expect(host.textContent).not.toContain("Hochachse");

  act(() => setInputValue(slider, "123.5"));
  expect(onChange).toHaveBeenLastCalledWith(124);
  act(() => root!.render(<RotationControls rotation={124} onChange={onChange} />));
  act(() => {
    input.focus();
    setInputValue(input, "124.5");
    input.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
  });
  expect(onChange.mock.calls.every(([angle]) => Number.isInteger(angle))).toBe(true);
  expect(host.querySelector<HTMLInputElement>('[data-testid="input-rotation"]')?.value).toBe("124");

  act(() => {
    const current = host!.querySelector<HTMLInputElement>('[data-testid="input-rotation"]')!;
    current.focus();
    setInputValue(current, "361");
    current.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
  });
  expect(onChange).toHaveBeenLastCalledWith(360);
});
