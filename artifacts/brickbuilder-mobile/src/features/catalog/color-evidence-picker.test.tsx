// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import EvidencedColorPicker from "./EvidencedColorPicker";
import { indexColorEvidence } from "./color-evidence";
import { colorBelongsToFamily, filterColorPalette } from "./color-evidence";
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
  expect(container.querySelectorAll(".swatch[aria-pressed]")).toHaveLength(2);
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

it("sorts palette colors by their display names and replaces underscores", async () => {
  const unordered = [
    { name: "Warm_Tan", value: "#aa8866", ldrawCode: "3" },
    { name: "Blue", value: "#0000ff", ldrawCode: "1" },
    { name: "Dark_Green", value: "#00451a", ldrawCode: "2" },
  ];
  await act(async () => root.render(<EvidencedColorPicker palette={unordered} references={["unknown"]}
    locked={false} current={[]} mobile onChange={() => {}} />));
  const names = [...container.querySelectorAll(".mobile-color-option span:nth-child(2)")]
    .map(element => element.textContent);
  expect(names).toEqual(["Blue", "Dark Green", "Warm Tan"]);
});

it("filters color families and sorts by name or numeric LDraw code", () => {
  const palette = [
    { name: "Metallic_Silver", value: "#aaa", ldrawCode: "80" },
    { name: "Trans_Dark_Blue", value: "#00f", ldrawCode: "41" },
    { name: "Dark_Green", value: "#040", ldrawCode: "288" },
    { name: "Medium_Blue", value: "#77a", ldrawCode: "73" },
    { name: "Blue", value: "#00f", ldrawCode: "1" },
    { name: "Glitter_Trans_Clear", value: "#fff", ldrawCode: "114" },
    { name: "Fabuland_Brown", value: "#a76", ldrawCode: "118" },
  ];
  expect(filterColorPalette(palette, "", "dark", "name-asc").map(color => color.name)).toEqual(["Dark_Green"]);
  expect(filterColorPalette(palette, "", "light", "name-asc")).toEqual([]);
  expect(filterColorPalette(palette, "", "medium", "name-asc").map(color => color.name)).toEqual(["Medium_Blue"]);
  expect(filterColorPalette(palette, "", "transparent", "name-asc").map(color => color.name))
    .toEqual(["Glitter_Trans_Clear", "Trans_Dark_Blue"]);
  expect(filterColorPalette(palette, "", "metallic", "name-asc").map(color => color.name)).toEqual(["Metallic_Silver"]);
  expect(filterColorPalette(palette, "", "special", "name-asc").map(color => color.name)).toEqual(["Glitter_Trans_Clear"]);
  expect(filterColorPalette(palette, "", "other", "name-asc").map(color => color.name)).toEqual(["Fabuland_Brown"]);
  expect(filterColorPalette(palette, "blue", "all", "name-asc").map(color => color.ldrawCode))
    .toEqual(["1", "73", "41"]);
  expect(filterColorPalette(palette, "118", "all", "name-asc").map(color => color.name)).toEqual(["Fabuland_Brown"]);
  expect(filterColorPalette(palette, "", "all", "code-asc").map(color => color.ldrawCode))
    .toEqual(["1", "41", "73", "80", "114", "118", "288"]);
  expect(colorBelongsToFamily(palette[6], "other")).toBe(true);
});

it("searches, filters, and sorts the currently evidence-approved palette", async () => {
  const fullPalette = [
    { name: "Trans_Clear", value: "#fff", ldrawCode: "47" },
    { name: "Dark_Green", value: "#00451a", ldrawCode: "2" },
    { name: "Blue", value: "#0000ff", ldrawCode: "1" },
  ];
  const onChange = vi.fn();
  await act(async () => root.render(<EvidencedColorPicker palette={fullPalette} references={["unknown"]}
    locked={false} current={[]} mobile onChange={onChange} />));
  const search = container.querySelector<HTMLInputElement>('[data-testid="color-search"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(search, "dark");
    search.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(container.querySelectorAll(".mobile-color-option")).toHaveLength(1);
  expect(container.querySelector(".mobile-color-option")?.textContent).toContain("Dark Green");
  const transparent = container.querySelector<HTMLButtonElement>('[data-testid="color-family-transparent"]')!;
  await act(async () => transparent.click());
  expect(container.textContent).toContain("Keine Farben für diese Suche und Filter.");
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(search, "");
    search.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(container.querySelector('[data-testid="mobile-color-trans_clear"]')).not.toBeNull();
  await act(async () => container.querySelector<HTMLButtonElement>('[data-testid="color-family-all"]')!.click());
  const sort = container.querySelector<HTMLSelectElement>('[data-testid="color-sort"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(sort, "code-asc");
    sort.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect([...container.querySelectorAll(".mobile-color-option span:nth-child(2)")].map(element => element.textContent))
    .toEqual(["Blue", "Dark Green", "Trans Clear"]);
});
