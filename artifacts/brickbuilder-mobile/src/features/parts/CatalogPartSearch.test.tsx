// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import CatalogPartSearch, { incomingLDrawIds } from "./CatalogPartSearch";
import type { CatalogSearchResult } from "../catalog/client";

const search = vi.hoisted(() => vi.fn());
vi.mock("../catalog/client", () => ({ searchBuildingCatalog: search }));
vi.mock("../inventory/InventoryThumbnail", () => ({
  default: ({ ldrawId }: { ldrawId: string }) => <span data-testid={`cached-preview-${ldrawId}`} />,
}));
let root: ReturnType<typeof createRoot> | undefined;
let host: HTMLDivElement;
const mapped: CatalogSearchResult = {
  id: "rb-cone", name: "Cone not included in an installed package ".repeat(4),
  mappings: [["rb-cone", "LD", "99999", "False", "True"], ["rb-cone", "BL", "cone-bl", "True", "True"]],
};
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Unexpected geometry download"); }));
  search.mockReset();
  host = document.createElement("div");
  root = createRoot(host);
});
afterEach(async () => { if (root) await act(async () => root!.unmount()); vi.unstubAllGlobals(); });
async function render(query: string, select = vi.fn()) {
  await act(async () => root!.render(<CatalogPartSearch query={query} category="" installedIds={new Set(["3001"])}
    color="#B40000" colorCode="4" loading={false} onSelect={select} />));
}
async function settle(check: () => void) {
  await vi.waitFor(async () => {
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
    check();
  }, { timeout: 3000 });
}

it("finds nonbundled parts and hands their exact LDraw identity to the existing placement flow", async () => {
  const select = vi.fn();
  search.mockResolvedValue({ results: [mapped], total: 1 });
  await render("cone", select);
  await settle(() => expect(host.querySelector('[data-testid="button-catalog-build-rb-cone"]')).not.toBeNull());
  expect(host.textContent).toContain("Nicht als Teilepaket installiert");
  expect(host.textContent).toContain("BrickLink cone-bl");
  await act(async () => host.querySelector<HTMLButtonElement>('[data-testid="button-catalog-build-rb-cone"]')!.click());
  expect(select).toHaveBeenCalledWith(expect.objectContaining({
    ldrawId: "99999", file: "parts/99999.dat", brickLinkId: "cone-bl", packageId: "catalog",
  }));
  expect(fetch).not.toHaveBeenCalled();
});

it("retains unknown records, rejects output-only IDs and requires an explicit ambiguous choice", async () => {
  const ambiguous = { ...mapped, id: "ambiguous", mappings: [
    ["ambiguous", "LD", "3001", "True", "True"], ["ambiguous", "LD", "3002", "True", "True"],
    ["ambiguous", "LD", "output-only", "True", "False"], ["ambiguous", "LD", "../bad", "True", "True"],
  ] };
  expect(incomingLDrawIds(ambiguous)).toEqual(["3001", "3002"]);
  search.mockResolvedValue({ results: [ambiguous, { id: "unknown", name: "Cone without mapping", mappings: [] }], total: 2 });
  const select = vi.fn();
  await render("cone", select);
  await settle(() => expect(host.querySelectorAll(".plib-catalog-row")).toHaveLength(2));
  const button = host.querySelector<HTMLButtonElement>('[data-testid="button-catalog-build-ambiguous"]')!;
  expect(button.disabled).toBe(true);
  expect(host.querySelector<HTMLButtonElement>('[data-testid="button-catalog-build-unknown"]')!.disabled).toBe(true);
  await act(async () => {
    const input = host.querySelector("select")!;
    input.value = "3001"; input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(button.disabled).toBe(false);
  expect(host.textContent).toContain("Offline installiert");
  await act(async () => button.click());
  expect(select).toHaveBeenCalledWith(expect.objectContaining({ ldrawId: "3001" }));
});

it("paginates metadata, rejects late old results and recovers from catalog errors", async () => {
  let old!: (value: unknown) => void;
  search.mockImplementationOnce(() => new Promise(resolve => { old = resolve; }));
  await render("old");
  await settle(() => expect(search).toHaveBeenCalledOnce());
  search.mockRejectedValueOnce(new Error("Offline catalog unavailable"));
  await render("cone");
  await settle(() => expect(host.querySelector('[role="alert"]')).not.toBeNull());
  await act(async () => old({ results: [{ id: "stale", name: "Stale", mappings: [] }], total: 1 }));
  expect(host.textContent).not.toContain("Stale");
  search.mockResolvedValue({ results: [mapped], total: 81 });
  await act(async () => [...host.querySelectorAll("button")].find(button => button.textContent === "Erneut")!.click());
  await settle(() => expect(host.textContent).toContain("Seite 1 / 3"));
  await act(async () => [...host.querySelectorAll("button")].find(button => button.textContent === "Weiter")!.click());
  await settle(() => expect(search).toHaveBeenLastCalledWith("cone", 40, ""));
  expect(fetch).not.toHaveBeenCalled();
});
