// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import TiltControls from "./TiltControls";

let root: ReturnType<typeof createRoot> | undefined;
let host: HTMLDivElement | undefined;
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
