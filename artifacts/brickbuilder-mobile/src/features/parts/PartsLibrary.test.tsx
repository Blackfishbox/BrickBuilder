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
