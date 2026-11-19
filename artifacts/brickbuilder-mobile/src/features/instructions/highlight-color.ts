import { Color } from "three";

/** Matches the construction-step highlight colors without changing source colors. */
export function instructionDisplayColor(source: Color, active: boolean): Color {
  return active ? source : source.lerp(new Color("#ffffff"), 0.62);
}
