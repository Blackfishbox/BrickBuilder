import { Color } from "three";

/** Matches the construction-step highlight colors without changing source colors. */
export function instructionDisplayColor(source: Color, active: boolean): Color {
  if (active) return source.lerp(new Color("#00d3b8"), 0.65);
  const grey = source.r * 0.2126 + source.g * 0.7152 + source.b * 0.0722;
  return source.setRGB(grey, grey, grey).lerp(new Color().setRGB(0.72, 0.72, 0.72), 0.65);
}
