// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyColorTheme,
  COLOR_THEME_STORAGE_KEY,
  LEGACY_COLOR_THEME_STORAGE_KEY,
  nextColorThemePreference,
  readColorTheme,
  readSystemColorTheme,
  resolveColorTheme,
  watchSystemColorTheme,
} from "./color-theme";

describe("system and saved color theme", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.classList.remove("dark");
    document.documentElement.style.colorScheme = "";
    document.querySelector('meta[name="theme-color"]')?.remove();
  });

  it("defaults to system, resolves the operating-system preference, and restores saved overrides", () => {
    localStorage.setItem(LEGACY_COLOR_THEME_STORAGE_KEY, "light");
    expect(readColorTheme()).toBe("system");
    expect(readSystemColorTheme({ matchMedia: () => ({ matches: true } as MediaQueryList) })).toBe("dark");
    expect(resolveColorTheme("system", "dark")).toBe("dark");
    expect(resolveColorTheme("system", "light")).toBe("light");
    applyColorTheme("dark");
    expect(localStorage.getItem(COLOR_THEME_STORAGE_KEY)).toBe("dark");
    expect(readColorTheme()).toBe("dark");
  });

  it("cycles from system to light to dark and back to system", () => {
    expect(nextColorThemePreference("system")).toBe("light");
    expect(nextColorThemePreference("light")).toBe("dark");
    expect(nextColorThemePreference("dark")).toBe("system");
  });

  it("applies the system preference while keeping system mode saved", () => {
    applyColorTheme("system", document, localStorage, "dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(document.documentElement.style.colorScheme).toBe("dark");
    expect(localStorage.getItem(COLOR_THEME_STORAGE_KEY)).toBe("system");
    applyColorTheme("system", document, localStorage, "light");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  it("updates while following system changes and removes the media listener", () => {
    let listener: ((event: MediaQueryListEvent) => void) | undefined;
    const removeEventListener = vi.fn();
    const media = {
      matches: false,
      addEventListener: (_type: string, callback: (event: MediaQueryListEvent) => void) => { listener = callback; },
      removeEventListener,
    } as unknown as MediaQueryList;
    const themes: string[] = [];
    const stop = watchSystemColorTheme(theme => themes.push(theme), {
      matchMedia: () => media,
    });
    media.matches = true;
    listener?.({ matches: true } as MediaQueryListEvent);
    expect(themes).toEqual(["light", "dark"]);
    stop();
    expect(removeEventListener).toHaveBeenCalledWith("change", listener);
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
