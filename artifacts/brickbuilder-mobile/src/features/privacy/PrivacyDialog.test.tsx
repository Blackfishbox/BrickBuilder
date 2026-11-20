// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import PrivacyDialog from "./PrivacyDialog";

it("opens the bundled policy without leaving the editor and allows closing", () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div"); document.body.appendChild(host);
  const root = createRoot(host), onClose = vi.fn();
  try {
    act(() => root.render(<PrivacyDialog onClose={onClose} />));
    const dialog = document.querySelector("[role='dialog']")!;
    expect(dialog.textContent).toContain("Android-Fassung");
    expect(dialog.querySelector("iframe")?.getAttribute("src")).toBe(`${import.meta.env.BASE_URL}privacy.html`);
    act(() => dialog.querySelector<HTMLButtonElement>("button")!.click());
    expect(onClose).toHaveBeenCalledOnce();
  } finally {
    act(() => root.unmount()); host.remove(); vi.unstubAllGlobals();
  }
});

it("persists Android opt-in and allows withdrawal after reopening", () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubEnv("VITE_NATIVE_ANDROID", "true");
  localStorage.clear();
  const host = document.createElement("div"); document.body.appendChild(host);
  let root = createRoot(host);
  try {
    act(() => root.render(<PrivacyDialog onClose={() => {}} />));
    let checkbox = document.querySelector<HTMLInputElement>("input[type=checkbox]")!;
    expect(checkbox.checked).toBe(false);
    expect(document.querySelector("[role=dialog]")?.textContent).toContain("IP address");
    act(() => checkbox.click());
    expect(checkbox.checked).toBe(true);
    act(() => root.unmount());
    root = createRoot(host);
    act(() => root.render(<PrivacyDialog onClose={() => {}} />));
    checkbox = document.querySelector<HTMLInputElement>("input[type=checkbox]")!;
    expect(checkbox.checked).toBe(true);
    act(() => checkbox.click());
    expect(checkbox.checked).toBe(false);
  } finally {
    act(() => root.unmount()); host.remove(); localStorage.clear();
    vi.unstubAllGlobals(); vi.unstubAllEnvs();
  }
});
