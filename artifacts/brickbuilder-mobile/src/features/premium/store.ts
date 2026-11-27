import type { CustomerInfo, PurchasesPackage } from "@revenuecat/purchases-capacitor";
import config from "./revenuecat-config.json";

export interface PremiumState {
  status: "idle" | "loading" | "ready" | "error";
  active: boolean;
  package: PurchasesPackage | null;
}
let state: PremiumState = { status: "idle", active: false, package: null };
const listeners = new Set<() => void>();
let initialization: Promise<void> | undefined;
let sdk: typeof import("@revenuecat/purchases-capacitor").Purchases;
let configured = false;
let listening = false;
let refreshing: Promise<void> | undefined;
const android = () => import.meta.env.VITE_NATIVE_ANDROID === "true";

export function premiumActive(): boolean { return android() && state.active; }
export function getPremiumState(): PremiumState { return state; }
export function subscribePremium(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
function update(patch: Partial<PremiumState>) {
  state = { ...state, ...patch };
  listeners.forEach(listener => listener());
}
function applyCustomerInfo(info: CustomerInfo) {
  // Only RevenueCat's verified, active entitlement grants access, never a local flag.
  const entitlement = info.entitlements.active[config.entitlement];
  const verification = info.entitlements.verification;
  update({ active: Boolean(entitlement?.isActive) && verification !== "FAILED" });
}
async function loadOffering() {
  const offerings = await sdk.getOfferings();
  const lifetime = offerings.current?.availablePackages.find(pkg =>
    pkg.packageType === "LIFETIME" && pkg.product.identifier === config.product &&
    pkg.product.productCategory === "NON_SUBSCRIPTION");
  update({ package: lifetime ?? null });
}
export async function initializePremium(): Promise<void> {
  if (!android()) return;
  if (!initialization) {
    initialization = (async () => {
      update({ status: "loading" });
      try {
        if (!config.androidPublicApiKey.startsWith("goog_")) throw new Error("Missing Google Play SDK configuration");
        const module = await import("@revenuecat/purchases-capacitor");
        sdk = module.Purchases;
        if (!configured) {
          await sdk.configure({ apiKey: config.androidPublicApiKey,
            entitlementVerificationMode: module.ENTITLEMENT_VERIFICATION_MODE.INFORMATIONAL });
          configured = true;
        }
        if (!listening) {
          await sdk.addCustomerInfoUpdateListener(applyCustomerInfo);
          listening = true;
        }
        applyCustomerInfo((await sdk.getCustomerInfo()).customerInfo);
        update({ status: "ready" });
        // Unavailable store products must not revoke an already owned entitlement.
        try { await loadOffering(); } catch { /* The purchase dialog provides a retry. */ }
        if (typeof document !== "undefined") document.addEventListener("visibilitychange", () => {
          if (document.visibilityState === "visible") void refreshPremium().catch(() => undefined);
        });
      } catch (error) {
        update({ status: "error" });
        initialization = undefined;
        throw error;
      }
    })();
  }
  return initialization;
}
export async function refreshPremium(): Promise<void> {
  if (!android()) return;
  await initializePremium();
  if (!refreshing) {
    refreshing = (async () => {
      applyCustomerInfo((await sdk.getCustomerInfo()).customerInfo);
      await loadOffering();
      update({ status: "ready" });
    })().finally(() => { refreshing = undefined; });
  }
  return refreshing;
}
export type PurchaseOutcome = "purchased" | "cancelled" | "pending";
export async function purchasePremium(): Promise<PurchaseOutcome> {
  if (!android()) throw new Error("Google Play purchases require the Android app");
  await initializePremium();
  if (premiumActive()) return "purchased";
  const pkg = state.package;
  if (!pkg) throw new Error("Premium product unavailable");
  try {
    const { customerInfo } = await sdk.purchasePackage({ aPackage: pkg });
    applyCustomerInfo(customerInfo);
    return premiumActive() ? "purchased" : "pending";
  } catch (error) {
    const failure = error as { userCancelled?: boolean; code?: string | number };
    if (failure.userCancelled || String(failure.code) === "1") return "cancelled";
    if (String(failure.code) === "20") return "pending";
    throw error;
  }
}
export async function restorePremium(): Promise<boolean> {
  if (!android()) throw new Error("Google Play purchases require the Android app");
  await initializePremium();
  applyCustomerInfo((await sdk.restorePurchases()).customerInfo);
  return premiumActive();
}
