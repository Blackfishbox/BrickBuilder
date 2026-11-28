export type ColorTheme = "light" | "dark";
export type ColorThemePreference = ColorTheme | "system";

// Older releases always wrote light/dark on startup, so that key cannot tell
// an explicit choice from the previous default. A fresh key lets every
// existing installation adopt the system default while keeping new choices.
export const COLOR_THEME_STORAGE_KEY = "brickbuilder-color-theme-preference";
export const LEGACY_COLOR_THEME_STORAGE_KEY = "brickbuilder-color-theme";

export function readSystemColorTheme(windowRef?: Pick<Window, "matchMedia">): ColorTheme {
  try {
    const browser = windowRef ?? (typeof window === "undefined" ? undefined : window);
    return browser?.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  } catch {
    return "light";
  }
}

export function resolveColorTheme(
  preference: ColorThemePreference,
  systemTheme: ColorTheme = readSystemColorTheme(),
): ColorTheme {
  return preference === "system" ? systemTheme : preference;
}

export function nextColorThemePreference(preference: ColorThemePreference): ColorThemePreference {
  if (preference === "system") return "light";
  if (preference === "light") return "dark";
  return "system";
}

export function watchSystemColorTheme(
  onChange: (theme: ColorTheme) => void,
  windowRef?: Pick<Window, "matchMedia">,
): () => void {
  try {
    const browser = windowRef ?? (typeof window === "undefined" ? undefined : window);
    const media = browser?.matchMedia("(prefers-color-scheme: dark)");
    if (!media) return () => undefined;
    const update = () => onChange(media.matches ? "dark" : "light");
    update();
    media.addEventListener?.("change", update);
    return () => media.removeEventListener?.("change", update);
  } catch {
    return () => undefined;
  }
}

export function readColorTheme(storage?: Pick<Storage, "getItem">): ColorThemePreference {
  try {
    const source = storage ?? (typeof window === "undefined" ? undefined : window.localStorage);
    const saved = source?.getItem(COLOR_THEME_STORAGE_KEY);
    return saved === "light" || saved === "dark" ? saved : "system";
  } catch {
    return "system";
  }
}

export function applyColorTheme(
  preference: ColorThemePreference,
  documentRef: Document = document,
  storage?: Pick<Storage, "setItem">,
  systemTheme: ColorTheme = readSystemColorTheme(),
): void {
  const theme = resolveColorTheme(preference, systemTheme);
  documentRef.documentElement.classList.toggle("dark", theme === "dark");
  documentRef.documentElement.style.colorScheme = theme;
  documentRef.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
    ?.setAttribute("content", theme === "dark" ? "#111a18" : "#214a42");
  try {
    const target = storage ?? (typeof window === "undefined" ? undefined : window.localStorage);
    target?.setItem(COLOR_THEME_STORAGE_KEY, preference);
  } catch {
    // The visible theme still changes when browser storage is unavailable.
  }
}
