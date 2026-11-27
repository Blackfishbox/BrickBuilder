import { useEffect, useSyncExternalStore } from "react";
import { getPremiumState, initializePremium, subscribePremium } from "./store";

export function usePremium() {
  const state = useSyncExternalStore(subscribePremium, getPremiumState, getPremiumState);
  useEffect(() => { void initializePremium().catch(() => undefined); }, []);
  return state;
}
