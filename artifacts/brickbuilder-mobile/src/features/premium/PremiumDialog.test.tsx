// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import PremiumDialog from "./PremiumDialog";

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(async () => {}), buy: vi.fn(async () => "pending"), restore: vi.fn(async () => false),
  state: { active: false, package: { product: { title: "Premium Lifetime", priceString: "€6.49" } } as any },
}));
vi.mock("./usePremium", () => ({ usePremium: () => mocks.state }));
vi.mock("./store", () => ({ refreshPremium: mocks.refresh, purchasePremium: mocks.buy, restorePremium: mocks.restore }));
let root: Root | undefined, host: HTMLElement;
afterEach(() => {
  act(() => root?.unmount()); host?.remove(); vi.clearAllMocks(); vi.unstubAllGlobals();
  localStorage.clear();
});
async function mount(locale: "en" | "de") {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.setItem("brickbuilder-language", locale);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => root!.render(<PremiumDialog onClose={() => {}} />));
}
it.each(["en", "de"] as const)("uses the store price and offers restoration in %s", async locale => {
  await mount(locale);
  const dialog = document.querySelector("[role=dialog]")!;
  expect(dialog.textContent).toContain("€6.49");
  expect(dialog.textContent).toContain("Premium Lifetime");
  expect(dialog.querySelector('[data-testid="button-premium-restore"]')).not.toBeNull();
  expect(dialog.textContent).toContain(locale === "de" ? "Kein Abonnement" : "No subscription");
  expect(dialog.textContent).toContain(locale === "de" ? "10 Inhaltsseiten" : "10 content pages");
  expect(dialog.textContent).toContain(locale === "de" ? "Premium und PWA haben kein Seitenlimit" : "Premium and the PWA have no page limit");
  expect(dialog.textContent).toContain(locale === "de" ? "wahlweise ohne BrickBuilder" : "option to omit BrickBuilder");
});
it("shows pending confirmation rather than claiming an unconfirmed payment succeeded", async () => {
  await mount("en");
  await act(async () => document.querySelector<HTMLButtonElement>('[data-testid="button-premium-purchase"]')!.click());
  expect(document.querySelector('[role=status]')?.textContent).toContain("Payment is pending");
});
it("reports that an account has no purchase after restoration", async () => {
  await mount("en");
  await act(async () => document.querySelector<HTMLButtonElement>('[data-testid="button-premium-restore"]')!.click());
  expect(document.querySelector('[role=status]')?.textContent).toContain("No Premium purchase");
});
