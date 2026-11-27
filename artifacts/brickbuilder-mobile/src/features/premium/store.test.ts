// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  configure: vi.fn(), listen: vi.fn(), info: vi.fn(), offerings: vi.fn(), buy: vi.fn(), restore: vi.fn(),
}));
vi.mock("@revenuecat/purchases-capacitor", () => ({
  ENTITLEMENT_VERIFICATION_MODE: { INFORMATIONAL: "INFORMATIONAL" },
  Purchases: {
    configure: mocks.configure, addCustomerInfoUpdateListener: mocks.listen, getCustomerInfo: mocks.info,
    getOfferings: mocks.offerings, purchasePackage: mocks.buy, restorePurchases: mocks.restore,
  },
}));
const info = (owned = false, verification = "VERIFIED") => ({
  entitlements: { verification, active: owned ? { brickbuilder_premium: { isActive: true } } : {} },
});
const pkg = { packageType: "LIFETIME", product: {
  identifier: "brickbuilder_premium", productCategory: "NON_SUBSCRIPTION", priceString: "€4.99",
} };
beforeEach(() => {
  vi.resetModules(); vi.resetAllMocks(); localStorage.clear();
  vi.stubEnv("VITE_NATIVE_ANDROID", "true");
  mocks.configure.mockResolvedValue(undefined); mocks.listen.mockResolvedValue("listener");
  mocks.info.mockResolvedValue({ customerInfo: info() });
  mocks.offerings.mockResolvedValue({ current: { availablePackages: [pkg] } });
  mocks.buy.mockResolvedValue({ customerInfo: info(true) });
  mocks.restore.mockResolvedValue({ customerInfo: info(true) });
});
afterEach(() => { vi.unstubAllEnvs(); });

describe("Android lifetime Premium", () => {
  it("never initializes billing or unlocks paid features in a PWA", async () => {
    vi.stubEnv("VITE_NATIVE_ANDROID", "false");
    const store = await import("./store");
    await store.initializePremium();
    expect(mocks.configure).not.toHaveBeenCalled();
    expect(store.premiumActive()).toBe(false);
  });
  it("initializes only once, requests verification, and ignores forged local ownership", async () => {
    localStorage.setItem("brickbuilder.premium", "true");
    const store = await import("./store");
    await Promise.all([store.initializePremium(), store.initializePremium()]);
    expect(mocks.configure).toHaveBeenCalledOnce();
    expect(mocks.configure).toHaveBeenCalledWith({
      apiKey: expect.stringMatching(/^goog_/), entitlementVerificationMode: "INFORMATIONAL",
    });
    expect(store.premiumActive()).toBe(false);
    expect(store.getPremiumState().package).toEqual(pkg);
  });
  it("unlocks only after a successful purchase confirms the active entitlement", async () => {
    const store = await import("./store");
    await store.initializePremium();
    expect(await store.purchasePremium()).toBe("purchased");
    expect(mocks.buy).toHaveBeenCalledWith({ aPackage: pkg });
    expect(store.premiumActive()).toBe(true);
  });
  it.each([{ userCancelled: true }, { code: "1" }])("does not unlock a cancelled purchase", async failure => {
    mocks.buy.mockRejectedValue(failure);
    const store = await import("./store");
    await store.initializePremium();
    expect(await store.purchasePremium()).toBe("cancelled");
    expect(store.premiumActive()).toBe(false);
  });
  it("leaves pending payments locked and accepts the later verified update", async () => {
    mocks.buy.mockRejectedValue({ code: "20" });
    const store = await import("./store");
    await store.initializePremium();
    expect(await store.purchasePremium()).toBe("pending");
    expect(store.premiumActive()).toBe(false);
    mocks.listen.mock.calls[0][0](info(true));
    expect(store.premiumActive()).toBe(true);
  });
  it("does not unlock a purchase result without its entitlement", async () => {
    mocks.buy.mockResolvedValue({ customerInfo: info() });
    const store = await import("./store");
    expect(await store.purchasePremium()).toBe("pending");
    expect(store.premiumActive()).toBe(false);
  });
  it("restores a purchase and revokes access when RevenueCat reports a refund", async () => {
    const store = await import("./store");
    expect(await store.restorePremium()).toBe(true);
    expect(store.premiumActive()).toBe(true);
    mocks.listen.mock.calls[0][0](info());
    expect(store.premiumActive()).toBe(false);
  });
  it("retains SDK-cached access offline even if store offerings fail", async () => {
    mocks.info.mockResolvedValue({ customerInfo: info(true) });
    mocks.offerings.mockRejectedValue(new Error("offline"));
    const store = await import("./store");
    await store.initializePremium();
    expect(store.premiumActive()).toBe(true);
    expect(store.getPremiumState().status).toBe("ready");
  });
  it("rejects entitlements whose signature verification failed", async () => {
    mocks.info.mockResolvedValue({ customerInfo: info(true, "FAILED") });
    const store = await import("./store");
    await store.initializePremium();
    expect(store.premiumActive()).toBe(false);
  });
  it("does not offer subscriptions or consumables as lifetime Premium", async () => {
    mocks.offerings.mockResolvedValue({ current: { availablePackages: [
      { ...pkg, packageType: "MONTHLY" },
      { ...pkg, product: { ...pkg.product, productCategory: "SUBSCRIPTION" } },
    ] } });
    const store = await import("./store");
    await store.initializePremium();
    expect(store.getPremiumState().package).toBeNull();
    await expect(store.purchasePremium()).rejects.toThrow("unavailable");
    expect(mocks.buy).not.toHaveBeenCalled();
  });
  it("allows retrying initialization after a temporary connection failure", async () => {
    mocks.configure.mockRejectedValueOnce(new Error("offline"));
    const store = await import("./store");
    await expect(store.initializePremium()).rejects.toThrow("offline");
    await store.initializePremium();
    expect(store.getPremiumState().status).toBe("ready");
  });
  it("does not configure or attach listeners twice when an initial entitlement request fails", async () => {
    mocks.info.mockRejectedValueOnce(new Error("offline"));
    const store = await import("./store");
    await expect(store.initializePremium()).rejects.toThrow("offline");
    await store.initializePremium();
    expect(mocks.configure).toHaveBeenCalledOnce();
    expect(mocks.listen).toHaveBeenCalledOnce();
    expect(store.getPremiumState().status).toBe("ready");
  });
});
