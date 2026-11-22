// @vitest-environment jsdom
import { act } from "react";
import { useI18n, I18nProvider, LANGUAGE_STORAGE_KEY } from "./I18nProvider";
import { translate } from "./messages";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it } from "vitest";

function LanguageProbe() {
  const { locale, setLocale, t } = useI18n();
  return <div>
    <span data-testid="view-label">{t("editor.viewMode")}</span>
    <span data-testid="locale">{locale}</span>
    <button onClick={() => setLocale(locale === "en" ? "de" : "en")}>Switch</button>
  </div>;
}

let root: Root | undefined;
let host: HTMLDivElement | undefined;

afterEach(() => {
  if (root) act(() => root!.unmount());
  root = undefined;
  host?.remove();
  host = undefined;
  localStorage.clear();
  document.documentElement.lang = "";
});

it("defaults to English, persists the selected language, and updates the document language", async () => {
  localStorage.removeItem(LANGUAGE_STORAGE_KEY);
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);

  await act(async () => root!.render(<I18nProvider><LanguageProbe /></I18nProvider>));
  expect(host.querySelector('[data-testid="view-label"]')?.textContent).toBe("View");
  expect(document.documentElement.lang).toBe("en");
  expect(localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBeNull();

  await act(async () => host!.querySelector("button")!.click());
  expect(host.querySelector('[data-testid="view-label"]')?.textContent).toBe("Ansicht");
  expect(document.documentElement.lang).toBe("de");
  expect(localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe("de");

  await act(async () => host!.querySelector("button")!.click());
  expect(host.querySelector('[data-testid="view-label"]')?.textContent).toBe("View");
  expect(localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe("en");
});

it("restores a previously selected German language", async () => {
  localStorage.setItem(LANGUAGE_STORAGE_KEY, "de");
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);

  await act(async () => root!.render(<I18nProvider><LanguageProbe /></I18nProvider>));
  expect(host.querySelector('[data-testid="view-label"]')?.textContent).toBe("Ansicht");
  expect(document.documentElement.lang).toBe("de");
});

it("uses the accurate stud-connection label in both menu languages", () => {
  expect(translate("de", "tilt.anchor.cylinder")).toBe("Noppenverbindung");
  expect(translate("en", "tilt.anchor.cylinder")).toBe("Stud connection");
});
