import { DirectionalLight, Group, HemisphereLight } from "three";

export const BUILDER_LIGHTING = {
  sky: 0xffffff, ground: 0x808080, hemisphere: 0.65, sun: 0.35,
  direction: [-8, 18, 11] as const,
};

/** Neutral, bounded lighting keeps source sRGB hues free of warm/green casts. */
export function createBuilderLighting(): Group {
  const group = new Group();
  // Three.js Lambert diffuse uses 1 / PI. Budget PI total irradiance, not
  // one, so neutral white does not become grey while avoiding overexposure.
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
