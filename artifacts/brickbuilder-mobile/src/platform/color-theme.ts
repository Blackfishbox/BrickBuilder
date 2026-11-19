export type ColorTheme = "light" | "dark";

export const COLOR_THEME_STORAGE_KEY = "brickbuilder-color-theme";

export function readColorTheme(storage?: Pick<Storage, "getItem">): ColorTheme {
  try {
    const source = storage ?? (typeof window === "undefined" ? undefined : window.localStorage);
    return source?.getItem(COLOR_THEME_STORAGE_KEY) === "dark" ? "dark" : "light";
  } catch {
    return "light";
  }
}

export function applyColorTheme(
  theme: ColorTheme,
  documentRef: Document = document,
  storage?: Pick<Storage, "setItem">,
): void {
  documentRef.documentElement.classList.toggle("dark", theme === "dark");
  documentRef.documentElement.style.colorScheme = theme;
  documentRef.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
    ?.setAttribute("content", theme === "dark" ? "#111a18" : "#214a42");
  try {
    const target = storage ?? (typeof window === "undefined" ? undefined : window.localStorage);
    target?.setItem(COLOR_THEME_STORAGE_KEY, theme);
  } catch {
    // The visible theme still changes when browser storage is unavailable.
  }
}
