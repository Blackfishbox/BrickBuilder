import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { expect, it } from "vitest";

const pages = [
  {
    file: "../../../../landing-page/index.html",
    englishSelector: ".hero h1",
    germanSelector: ".hero h1",
    english: "Your ideas.Built in 3D.",
    german: "Deine Ideen.Direkt in 3D.",
  },
  {
    file: "../../public/privacy.html",
    englishSelector: "[data-copy=title]",
    germanSelector: "[data-copy=title]",
    english: "Privacy Policy",
    german: "Datenschutzerklärung",
  },
  {
    file: "../../../../landing-page/privacy.html",
    englishSelector: 'main[data-language="en"] h1',
    germanSelector: 'main[data-language="de"] h1',
    english: "Privacy information",
    german: "Datenschutzhinweise",
  },
];

it.each(pages)("defaults to German and switches $file to English", ({ file, english, german, englishSelector, germanSelector }) => {
  const dom = new JSDOM(readFileSync(new URL(file, import.meta.url), "utf8"), {
    runScripts: "dangerously",
    url: "https://brickbuilder.test/",
  });
  try {
    const { document, localStorage } = dom.window;
    expect(document.documentElement.lang).toBe("de");
    expect(document.querySelector(germanSelector)?.textContent?.replace(/\s+/g, "")).toBe(german.replace(/\s+/g, ""));
    const button = document.querySelector<HTMLButtonElement>("#language-toggle")!;
    button.click();
    expect(document.documentElement.lang).toBe("en");
    expect(localStorage.getItem("brickbuilder-language")).toBe("en");
    expect(document.querySelector(englishSelector)?.textContent?.replace(/\s+/g, "")).toBe(english.replace(/\s+/g, ""));
    button.click();
    expect(document.documentElement.lang).toBe("de");
  } finally {
    dom.window.close();
  }
});
