// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import EvidencedColorPicker from "./EvidencedColorPicker";
import { indexColorEvidence } from "./color-evidence";
import { updateColorEvidenceState } from "./color-evidence-state";

vi.mock("./client", async () => {
  const { useSyncExternalStore } = await import("react");
  const state = await import("./color-evidence-state");
  return { ensureColorEvidence: async () => {},
    useColorEvidence: () => useSyncExternalStore(state.subscribeColorEvidence, state.getColorEvidenceState, state.getColorEvidenceState) };
});
let root: Root;
let container: HTMLDivElement;
const palette = [{ name: "Red", value: "#ff0000", ldrawCode: "4" }, { name: "Blue", value: "#0000ff", ldrawCode: "1" }];
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  updateColorEvidenceState({ status: "ready", index: indexColorEvidence({
    schema: 1, version: "test", snapshotDate: "2026-11-16",
    ldParts: [["base", "rb-base"], ["basep01", "rb-print"], ["second", "rb-second"],
      ["ambiguous", "rb-base"], ["ambiguous", "rb-print"]],
    ldColors: [["4", "100", "True", "True"], ["1", "101", "True", "True"]],
    pairs: { "rb-base": ["100", "101"], "rb-print": ["101"], "rb-second": ["100"] },
  }) });
  container = document.createElement("div");
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  updateColorEvidenceState({ status: "idle" });
  vi.unstubAllGlobals();
});
it("defaults to proven colors and shows a retained out-of-snapshot direct color without recoloring", async () => {
  const onChange = vi.fn();
  await act(async () => root.render(<EvidencedColorPicker palette={palette} references={["basep01"]} locked={false}
    current={[{ name: "Imported", value: "#abcdef", ldrawCode: "0x2ABCDEF" }]} onChange={onChange} />));
  expect(container.textContent).toContain("Nachgewiesene Farben");
  expect(container.textContent).toContain("öffentliche Inventare offizieller Sets und Minifiguren");
  expect(container.querySelector('[aria-label="Blue auswählen"]')).not.toBeNull();
  expect(container.querySelector('[aria-label="Red auswählen"]')).toBeNull();
  expect(container.textContent).toContain("0x2ABCDEF");
  expect(container.querySelector('[data-testid="preserved-colors"]')?.textContent).toContain("nicht gemeinsam nachgewiesen");
  expect(onChange).not.toHaveBeenCalled();
});
it("leaves unknown and ambiguous selections unrestricted with an explicit explanation", async () => {
  await act(async () => root.render(<EvidencedColorPicker palette={palette} references={["unknown", "ambiguous"]}
    locked={false} current={[palette[0]]} onChange={() => {}} />));
  expect(container.textContent).toContain("Farbverfügbarkeit unbekannt");
  expect(container.textContent).toContain("mehrdeutige");
  expect(container.querySelectorAll('[aria-pressed]')).toHaveLength(2);
});
it("offers an intersection for mixed selections and locks all inventory recoloring", async () => {
  const onChange = vi.fn();
  await act(async () => root.render(<EvidencedColorPicker palette={palette} references={["base", "second", "unknown"]}
    locked={false} current={[palette[1]]} mobile onChange={onChange} />));
  expect(container.querySelector('[aria-label="Red auswählen"]')).not.toBeNull();
  expect(container.querySelector('[aria-label="Blue auswählen"]')).toBeNull();
  expect(container.textContent).toContain("Teil ohne Nachweis schränkt die Auswahl nicht ein");
  await act(async () => root.render(<EvidencedColorPicker palette={palette} references={["base"]}
    locked current={[palette[0]]} onChange={onChange} />));
  const red = container.querySelector<HTMLButtonElement>('[aria-label="Red auswählen"]')!;
  expect(red.disabled).toBe(true);
  await act(async () => red.click());
  expect(onChange).not.toHaveBeenCalled();
  expect(container.textContent).toContain("Farbe ist für diese Auswahl festgelegt");
});
