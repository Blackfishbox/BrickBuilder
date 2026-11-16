import type { ColorEvidenceIndex } from "./color-evidence";
type EvidenceState = { status: "idle" | "loading" | "ready" | "error"; index?: ColorEvidenceIndex; error?: string };
let state: EvidenceState = { status: "idle" };
const listeners = new Set<() => void>();
export const getColorEvidenceState = () => state;
export const subscribeColorEvidence = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};
export function updateColorEvidenceState(next: EvidenceState) {
  state = next;
  listeners.forEach(listener => listener());
}
