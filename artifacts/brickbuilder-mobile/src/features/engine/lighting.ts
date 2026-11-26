import { DirectionalLight, Group, HemisphereLight } from "three";

export const BUILDER_LIGHTING = {
  sky: 0xffffff, ground: 0xa0a0a0, hemisphere: 0.82, sun: 0.35,
  direction: [-8, 18, 11] as const,
};

export const INSTRUCTION_LIGHTING = { ambient: 2.7, sun: 2.7 } as const;
export const THUMBNAIL_LIGHTING = { ambient: 0.85, sun: 1.35 } as const;
export const SOFTWARE_LIGHTING = { ambient: 0.74, direct: 0.26 } as const;

/** Brighter shadows without raising the maximum above the original part color. */
export function softwareLightIntensity(normalDotLight: number): number {
  return SOFTWARE_LIGHTING.ambient +
    SOFTWARE_LIGHTING.direct * Math.min(1, Math.abs(normalDotLight));
}

/** Neutral, bounded lighting keeps source sRGB hues free of warm/green casts. */
export function createBuilderLighting(): Group {
  const group = new Group();
  // Three.js Lambert diffuse uses 1 / PI. Budget PI total irradiance, not
  // one. Slightly stronger neutral fill opens shadows while retaining the
  // directional contrast that makes studs and part boundaries readable.
  const hemi = new HemisphereLight(BUILDER_LIGHTING.sky, BUILDER_LIGHTING.ground, Math.PI * BUILDER_LIGHTING.hemisphere);
  const sun = new DirectionalLight(0xffffff, Math.PI * BUILDER_LIGHTING.sun);
  sun.position.set(...BUILDER_LIGHTING.direction);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.left = -22;
  sun.shadow.camera.right = 22;
  sun.shadow.camera.top = 22;
  sun.shadow.camera.bottom = -22;
  sun.shadow.bias = -0.0004;
  group.add(hemi, sun);
  return group;
}
