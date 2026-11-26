import { DirectionalLight, HemisphereLight } from "three";
import { expect, it } from "vitest";
import { BUILDER_LIGHTING, createBuilderLighting, INSTRUCTION_LIGHTING, softwareLightIntensity, THUMBNAIL_LIGHTING } from "./lighting";

it("uses stronger neutral fill in the builder without losing directional light", () => {
  const lights = createBuilderLighting();
  const fill = lights.children.find(child => child instanceof HemisphereLight) as HemisphereLight;
  const sun = lights.children.find(child => child instanceof DirectionalLight) as DirectionalLight;
  expect(fill.intensity).toBeCloseTo(Math.PI * BUILDER_LIGHTING.hemisphere);
  expect(fill.intensity).toBeGreaterThan(Math.PI * 0.65);
  expect(fill.color.getHex()).toBe(0xffffff);
  expect(fill.groundColor.r).toBe(fill.groundColor.g);
  expect(fill.groundColor.g).toBe(fill.groundColor.b);
  expect(sun.intensity).toBeGreaterThan(0);
  expect(sun.position.toArray()).toEqual([...BUILDER_LIGHTING.direction]);
});

it("brightens PDF and thumbnail fill without removing their directional shading", () => {
  expect(INSTRUCTION_LIGHTING.ambient).toBeGreaterThan(2.1);
  expect(INSTRUCTION_LIGHTING.sun).toBe(2.7);
  expect(THUMBNAIL_LIGHTING.ambient).toBeGreaterThan(0.5);
  expect(THUMBNAIL_LIGHTING.sun).toBeGreaterThan(0);
});

it("brightens software-rendered shadows without bleaching source colors", () => {
  for (const dot of [-1, -0.8, -0.5, 0, 0.5, 0.8, 1]) {
    const intensity = softwareLightIntensity(dot);
    expect(intensity).toBeGreaterThanOrEqual(0.58 + 0.42 * Math.abs(dot) - 1e-12);
    expect(intensity).toBeLessThanOrEqual(1);
    expect(intensity).toBe(softwareLightIntensity(-dot));
  }
  expect(softwareLightIntensity(0)).toBe(0.74);
  expect(softwareLightIntensity(1)).toBe(1);
});
