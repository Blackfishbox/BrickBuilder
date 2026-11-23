// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { builderDatabase } from "@/storage/database";
import PartsLibrary from "./PartsLibrary";

vi.mock("../catalog/CatalogPanel", () => ({ default: () => null }));

afterEach(async () => {
  vi.unstubAllGlobals();
  await builderDatabase.delete();
});

it("automatically shows offline parts, bounds rendered results, filters categories and selects a part", async () => {
  await builderDatabase.open();
  vi.stubGlobal("fetch", vi.fn(async (url: string) =>
    new Response(readFileSync(resolve("public", url.replace(/^.*?parts\//, "parts/")))),
  ));
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const select = vi.fn();
  try {
    await act(async () => root.render(<PartsLibrary online={false} onSelect={select} />));
    await vi.waitFor(async () => {
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 100)); });
      expect(host.querySelectorAll(".plib-part")).toHaveLength(40);
    const searchInput = host.querySelector('[data-testid="input-search-library"]')!;
    const detailsHeading = host.querySelector("#plib-title")!;
    const catalogResults = host.querySelector('[aria-label="Gesamtkatalog-Treffer"]') ??
      host.querySelector(".plib-catalog-note")!;
    expect(Boolean(searchInput.compareDocumentPosition(detailsHeading) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
    expect(Boolean(catalogResults.compareDocumentPosition(detailsHeading) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
    }, { timeout: 15_000 });
    const more = Array.from(host.querySelectorAll("button")).find(button => button.textContent?.includes("Weitere Teile"))!;
    await act(async () => more.click());
    expect(host.querySelectorAll(".plib-part")).toHaveLength(80);
    await act(async () => host.querySelector<HTMLButtonElement>('[data-testid="button-category-Fliesen"]')!.click());
    await vi.waitFor(async () => {
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 100)); });
      expect(host.querySelectorAll(".plib-part")).toHaveLength(33);
    });
    await act(async () => host.querySelector<HTMLButtonElement>(".plib-part")!.click());
    expect(select).toHaveBeenCalledWith(expect.objectContaining({ category: "Fliesen", packageId: "ldraw-default-tiles" }));
    expect(host.textContent).toContain("Offline");
    expect(host.querySelector('[role="alert"]')).toBeNull();
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});

it("lets the user choose a quantity and place that many local parts", async () => {
  await builderDatabase.open();
  vi.stubGlobal("fetch", vi.fn(async (url: string) =>
    new Response(readFileSync(resolve("public", url.replace(/^.*?parts\//, "parts/")))),
  ));
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const place = vi.fn().mockResolvedValue(true);
  try {
    await act(async () => root.render(<PartsLibrary online={false} onSelect={vi.fn()} onPlaceQuantity={place} />));
    await vi.waitFor(async () => {
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 100)); });
      expect(host.querySelector('[data-testid="input-search-library"]')).not.toBeNull();
    }, { timeout: 15_000 });
    const searchInput = host.querySelector<HTMLInputElement>('[data-testid="input-search-library"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(searchInput, "3001");
      searchInput.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await vi.waitFor(async () => {
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 220)); });
      expect(host.querySelector('[data-testid="part-entry-3001"]')).not.toBeNull();
    }, { timeout: 5_000 });
    const entry = host.querySelector<HTMLElement>('[data-testid="part-entry-3001"]')!;
    const input = entry.querySelector<HTMLInputElement>('input[type="number"]')!;
    const button = entry.querySelector<HTMLButtonElement>(".plib-placement-button")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "6");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => button.click());
    expect(place).toHaveBeenCalledWith(expect.objectContaining({ ldrawId: "3001" }), 6);
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
