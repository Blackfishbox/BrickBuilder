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

it.each(pages)("defaults to English and switches $file to German", ({ file, english, german, englishSelector, germanSelector }) => {
  const dom = new JSDOM(readFileSync(new URL(file, import.meta.url), "utf8"), {
    runScripts: "dangerously",
    url: "https://brickbuilder.test/",
  });
  try {
    const { document, localStorage } = dom.window;
    expect(document.documentElement.lang).toBe("en");
    expect(document.querySelector(englishSelector)?.textContent?.replace(/\s+/g, "")).toBe(english.replace(/\s+/g, ""));
    const button = document.querySelector<HTMLButtonElement>("#language-toggle")!;
    button.click();
    expect(document.documentElement.lang).toBe("de");
    expect(localStorage.getItem("brickbuilder-language")).toBe("de");
    expect(document.querySelector(germanSelector)?.textContent?.replace(/\s+/g, "")).toBe(german.replace(/\s+/g, ""));
    button.click();
    expect(document.documentElement.lang).toBe("en");
  } finally {
    dom.window.close();
  }
});

it("keeps the privacy contact email visible after switching languages", () => {
  const dom = new JSDOM(readFileSync(new URL("../../public/privacy.html", import.meta.url), "utf8"), {
    runScripts: "dangerously",
    url: "https://brickbuilder.test/",
  });
  try {
    const { document } = dom.window;
    const contact = document.querySelector("main > section")!;
    const email = contact.querySelector<HTMLAnchorElement>('a[href="mailto:support@blackfishbox.de"]')!;
    expect(email.textContent).toBe("support@blackfishbox.de");
    expect(contact.querySelector('[data-copy="contactText"]')?.contains(email)).toBe(false);

    document.querySelector<HTMLButtonElement>("#language-toggle")!.click();

    expect(document.documentElement.lang).toBe("de");
    expect(email.isConnected).toBe(true);
    expect(email.textContent).toBe("support@blackfishbox.de");
  } finally {
    dom.window.close();
  }
});

it("distinguishes automatic PWA geometry requests from optional Android downloads", () => {
  const dom = new JSDOM(readFileSync(new URL("../../public/privacy.html", import.meta.url), "utf8"), {
    url: "https://brickbuilder.test/",
  });
  try {
    const { document } = dom.window;
    const english = document.querySelector("main[data-locale='en']")!.textContent!;
    const german = document.querySelector("main[data-locale='de']")!.textContent!;

    expect(english).toContain("the PWA automatically requests them");
    expect(english).toContain("There is no setting in the PWA to turn off these requests");
    expect(english).toContain("Online geometry loading is disabled by default");
    expect(english).not.toContain("This Android version");

    expect(german).toContain("fordert die PWA sie automatisch");
    expect(german).toContain("In der PWA gibt es keine Einstellung, um diese Anfragen zu deaktivieren");
    expect(german).toContain("Das Online-Nachladen von Geometrien ist standardmäßig deaktiviert");
    expect(german).not.toContain("Die hier beschriebene Android-Fassung");
  } finally {
    dom.window.close();
  }
});

it("uses the requested privacy labels and emphasizes the API URL", () => {
  const html = readFileSync(new URL("../../public/privacy.html", import.meta.url), "utf8");
  const dom = new JSDOM(html, { url: "https://brickbuilder.test/" });
  try {
    const { document } = dom.window;
    expect(document.querySelector('meta[name="description"]')?.content).toBe("Datenschutzerklärung für BrickBuilder.");
    const api = [...document.querySelectorAll("strong")].find(node =>
      node.textContent === "https://brickbuilder.blackfishbox.de/api");
    expect(api).toBeDefined();
    expect(document.querySelector('[data-copy="app-name"]')).toBeNull();
    expect(document.querySelector('[data-copy="title"]')?.textContent).toBe("Privacy Policy");
    expect(document.querySelector('main[data-locale="en"]')?.textContent).toContain(
      "considerable effort not undertaken by the server operator",
    );
    expect(document.querySelector('main[data-locale="de"]')?.textContent).toContain(
      "welcher vom Verantwortlichen des Servers nicht betrieben wird",
    );
  } finally {
    dom.window.close();
  }
});
