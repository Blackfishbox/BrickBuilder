import { Color } from "three";

/** Linear-sRGB luminance: about sRGB #383838, not the lit/displayed surface. */
export const DARK_PART_LUMINANCE = 0.04;

export function needsWhiteEdges(color: Color): boolean {
  return color.r * 0.2126 + color.g * 0.7152 + color.b * 0.0722 < DARK_PART_LUMINANCE;
}

/** Keep bright thick strokes part-colored; dark strokes and contrast cores are white. */
export function partEdgeColor(color: Color, thick = false, shade = 1): Color {
  if (needsWhiteEdges(color)) return new Color("#ffffff");
  return thick ? color.clone().multiplyScalar(shade) : new Color("#000000");
}

export const EDGE_CONTRAST_GLSL = `
  vec3 partContrastColor(vec3 linearColor) {
    return dot(linearColor, vec3(0.2126, 0.7152, 0.0722)) < ${DARK_PART_LUMINANCE}
      ? vec3(1.0) : vec3(0.0);
  }
`;

/** Lightweight fallback: one byte per vertex, three bytes per instance. */
export const FALLBACK_EDGE_VERTEX_HEADER = `
  attribute vec3 instanceEdgeColor;
  // 0: black, 1: white, 2: inherit the occurrence color.
  attribute float edgeContrastOverride;
  varying float vContrastInk;
  ${EDGE_CONTRAST_GLSL}
  vec3 fallbackColorToLinear(vec3 color) {
    return mix(pow((color + vec3(0.055)) / 1.055, vec3(2.4)), color / 12.92,
      lessThanEqual(color, vec3(0.04045)));
  }
`;
export const FALLBACK_EDGE_VERTEX = `
  vContrastInk = edgeContrastOverride < 1.5 ? edgeContrastOverride
    : partContrastColor(fallbackColorToLinear(instanceEdgeColor)).r;
`;
