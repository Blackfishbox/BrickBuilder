// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { applyColorTheme, COLOR_THEME_STORAGE_KEY, readColorTheme } from "./color-theme";

describe("saved color theme", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.classList.remove("dark");
    document.documentElement.style.colorScheme = "";
    document.querySelector('meta[name="theme-color"]')?.remove();
  });

  it("defaults to light and restores a saved dark theme", () => {
    expect(readColorTheme()).toBe("light");
    applyColorTheme("dark");
    expect(localStorage.getItem(COLOR_THEME_STORAGE_KEY)).toBe("dark");
    expect(readColorTheme()).toBe("dark");
  });

  it("updates the document theme and browser chrome color", () => {
    const meta = document.createElement("meta");
    meta.name = "theme-color";
    document.head.append(meta);
    applyColorTheme("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(document.documentElement.style.colorScheme).toBe("dark");
    expect(meta.content).toBe("#111a18");

    applyColorTheme("light");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(document.documentElement.style.colorScheme).toBe("light");
    expect(meta.content).toBe("#214a42");
  });

  it("still applies a theme when storage writes fail", () => {
    const storage = { setItem: () => { throw new Error("disabled"); } };
    expect(() => applyColorTheme("dark", document, storage)).not.toThrow();
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });
});
