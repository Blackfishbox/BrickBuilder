import { describe, expect, it } from "vitest";
import { Resvg } from "@resvg/resvg-js";
import {
  BufferGeometry, Color, DoubleSide, Float32BufferAttribute, FrontSide, Matrix4, Mesh,
  MeshBasicMaterial, MeshLambertMaterial, PlaneGeometry, Vector3,
} from "three";
import { renderSvgView } from "./svg-view-export";
import { projectedTriangle, vehicleFixture, visualCamera } from "./svg-visual-fixtures";
import { SvgFaces, SVG_LIMITS } from "./svg-export-buffer";
import { visibleOrder } from "./svg-visibility";

const SIZE = 256;
const decode = (b: Uint8Array) => new TextDecoder().decode(b);
function raster(svg: string, background?: string) {
  const image = new Resvg(svg, { background }).render();
  return image.pixels;
}
function pixel(data: Uint8Array, x: number, y: number) {
  return [...data.slice((y * SIZE + x) * 4, (y * SIZE + x) * 4 + 4)];
}

describe("rendered vector surface regressions", () => {
  it("resolves both halves of crossing sloped panels, not their mean depth", async () => {
    const camera = visualCamera();
    const roof = projectedTriangle(camera, [[-0.95, -0.95, 0.6], [0.95, -0.95, 0.6], [0, 0.95, 0.6]], "#ff0000");
    const longFace = projectedTriangle(camera, [[-0.9, -0.7, 0.9], [0.9, -0.7, 0.1], [-0.9, 0.9, 0.1]], "#0000ff");
    const svg = decode(await renderSvgView([roof, longFace], camera, SIZE, SIZE));
    for (const background of ["#ffffff", "#151515"]) {
      const data = raster(svg, background);
      // Interior overlap: roof hides the deep end; blue shows at the near end.
      expect(pixel(data, 70, 195)).toEqual([255, 0, 0, 255]);
      expect(pixel(data, 145, 195)).toEqual([0, 0, 255, 255]);
      expect(pixel(data, 0, 0)).toEqual(background === "#ffffff" ? [255, 255, 255, 255] : [21, 21, 21, 255]);
    }
    expect(pixel(raster(svg), 0, 0)[3]).toBe(0);
    expect(svg).not.toMatch(/<image|data:image|<foreignObject/);
    // Frozen reproduction of the old centre-depth order: blue (mean .366)
    // painted over red (mean .6), even where blue is locally behind the roof.
    const legacy = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="-128 -128 256 256"><path d="M-121.6,121.6L121.6,121.6L0,-121.6Z" fill="red"/><path d="M-115.2,89.6L115.2,89.6L-115.2,-115.2Z" fill="blue"/></svg>`;
    expect(pixel(raster(legacy), 70, 195)).toEqual([0, 0, 255, 255]);
  });

  it("matches an independent per-pixel depth/compositing oracle across crossing glass and body panels", async () => {
    const camera = visualCamera();
    const xy = [[-0.9, -0.8], [0.9, -0.8], [0, 0.9]];
    const depths = [[0.8, 0.2, 0.55], [0.3, 0.75, 0.45], [0.55, 0.55, 0.55]];
    const colors = [[255, 0, 0], [0, 0, 255], [0, 255, 0]];
    const alphas = [1, 0.5, 0.35];
    const objects = depths.map((values, i) => projectedTriangle(camera,
      xy.map((p, k) => [...p, values[k]]), ["red", "blue", "#00ff00"][i], alphas[i]));
    const data = raster(decode(await renderSvgView(objects, camera, SIZE, SIZE)), "#ffffff");
    let compared = 0;
    for (let y = 25; y < 220; y += 3) for (let x = 25; x < 230; x += 3) {
      const nx = (x + 0.5) / 128 - 1, ny = 1 - (y + 0.5) / 128;
      const c = (ny + 0.8) / 1.7, b = (nx + 0.9 - 0.9 * c) / 1.8, a = 1 - b - c;
      if (Math.min(a, b, c) < 0.035) continue; // skip rasterized silhouettes
      const z = depths.map(d => a * d[0] + b * d[1] + c * d[2]);
      if (Math.min(Math.abs(z[0] - z[1]), Math.abs(z[0] - z[2]), Math.abs(z[1] - z[2])) < 0.006) continue;
      const expected = [255, 255, 255];
      for (const i of [0, 1, 2].sort((i, j) => z[j] - z[i]))
        for (let k = 0; k < 3; k++) expected[k] = colors[i][k] * alphas[i] + expected[k] * (1 - alphas[i]);
      const actual = pixel(data, x, y);
      expected.forEach((value, k) => expect(Math.abs(value - actual[k])).toBeLessThan(3));
      compared++;
    }
    expect(compared).toBeGreaterThan(1500);
  });

  it("keeps glass behind opaque panels hidden and preserves separate front glass layers", async () => {
    const camera = visualCamera();
    const points = (z: number) => [[-0.8, -0.8, z], [0.8, -0.8, z], [0, 0.8, z]];
    const objects = [
      projectedTriangle(camera, points(0.9), "#00ff00", 0.5),
      projectedTriangle(camera, points(0.6), "#ff0000"),
      projectedTriangle(camera, points(0.4), "#0000ff", 0.5),
      projectedTriangle(camera, points(0.2), "#0000ff", 0.5),
    ];
    const data = raster(decode(await renderSvgView(objects, camera, SIZE, SIZE)));
    const center = pixel(data, 128, 140);
    expect(center[0]).toBeGreaterThanOrEqual(62);
    expect(center[0]).toBeLessThanOrEqual(65);
    expect(center[1]).toBe(0); expect(center[2]).toBeGreaterThanOrEqual(190);
    expect(center[3]).toBe(255);
  });

  it("paints a tessellated coplanar window once without diagonal alpha seams", async () => {
    const camera = visualCamera();
    const mesh = new Mesh(new PlaneGeometry(3, 3, 9, 9), new MeshLambertMaterial({
      color: "#ffffff", side: DoubleSide, transparent: true, opacity: 0.4,
    }));
    const svg = decode(await renderSvgView([mesh], camera, SIZE, SIZE));
    const data = raster(svg);
    for (let x = 90; x < 166; x++)
      for (let y = 90; y < 166; y++) expect(pixel(data, x, y)[3]).toBe(102);
  });

  it("interpolates smooth vertex lighting in linear light and preserves intentional hard edges", async () => {
    const camera = visualCamera();
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new Float32BufferAttribute([-2, -2, 0, 2, -2, 0, 0, 2, 0], 3));
    geometry.setAttribute("normal", new Float32BufferAttribute([0, 1, 0, 0, 0, 1, 0, -1, 0], 3));
    const material = new MeshLambertMaterial({ color: "#ffffff", side: DoubleSide });
    const mesh = new Mesh(geometry, material);
    const smooth = decode(await renderSvgView([mesh], camera, SIZE, SIZE));
    const data = raster(smooth);
    expect(pixel(data, 90, 185)[0] - pixel(data, 128, 80)[0]).toBeGreaterThan(50);
    expect(smooth).toContain('color-interpolation="linearRGB"');
    material.flatShading = true;
    const flat = raster(decode(await renderSvgView([mesh], camera, SIZE, SIZE)));
    expect(pixel(flat, 90, 185)[0]).toBe(pixel(flat, 128, 80)[0]);
    // Reflection must keep the same front-side lighting, not turn it inside out.
    material.flatShading = false;
    material.side = FrontSide;
    mesh.applyMatrix4(new Matrix4().makeScale(-1, 1, 1));
    const mirrored = raster(decode(await renderSvgView([mesh], camera, SIZE, SIZE)));
    expect(Math.abs(pixel(data, 90, 185)[0] - pixel(mirrored, 165, 185)[0])).toBeLessThan(2);
  });

  it("retains emissive material color instead of darkening it with diffuse lighting", async () => {
    const camera = visualCamera();
    const geometry = new PlaneGeometry(3, 3);
    const material = new MeshLambertMaterial({ color: "#000000", emissive: "#0080ff" });
    const image = raster(decode(await renderSvgView([new Mesh(geometry, material)], camera, SIZE, SIZE)));
    expect(pixel(image, 128, 128)).toEqual([0, 128, 255, 255]);
  });

  it("preserves indexed material groups and vertex color multiplication in rendered pixels", async () => {
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new Float32BufferAttribute([
      -2, -2, 0, 2, -2, 0, -2, 2, 0,
      2, -2, 0, 2, 2, 0, -2, 2, 0,
    ], 3));
    geometry.setIndex([0, 1, 2, 3, 4, 5]);
    geometry.setAttribute("color", new Float32BufferAttribute([
      1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 1,
    ], 3));
    geometry.addGroup(0, 3, 0); geometry.addGroup(3, 3, 1);
    const materials = [new MeshBasicMaterial({ color: "#808080", vertexColors: true }),
      new MeshBasicMaterial({ color: "#ffffff", vertexColors: true })];
    const image = raster(decode(await renderSvgView([new Mesh(geometry, materials)], visualCamera(), SIZE, SIZE)));
    expect(pixel(image, 80, 170)).toEqual([128, 0, 0, 255]);
    expect(pixel(image, 170, 80)).toEqual([0, 0, 255, 255]);
  });

  it("renders the public curved vehicle fixture repeatably on light and dark backgrounds", async () => {
    const { root, camera } = vehicleFixture();
    const svg = decode(await renderSvgView([root], camera, SIZE, SIZE));
    const light = raster(svg, "#ffffff"), dark = raster(svg, "#111111");
    let colored = 0, transparent = 0;
    const rgba = raster(svg);
    for (let i = 0; i < light.length; i += 4) {
      if (light[i] > light[i + 1] * 1.6 && light[i] > light[i + 2] * 1.6) colored++;
      if (!rgba[i + 3]) transparent++;
      if (rgba[i + 3] === 255) expect([...light.slice(i, i + 4)]).toEqual([...dark.slice(i, i + 4)]);
    }
    expect(colored).toBeGreaterThan(2500); expect(transparent).toBeGreaterThan(25000);
    expect(raster(svg)).toEqual(rgba);
    const expectedRoof = new Color("#b02025").multiplyScalar(
      0.65 + 0.35 * new Vector3(-8, 18, 11).normalize().y).getHex();
    const expected = [expectedRoof >> 16, (expectedRoof >> 8) & 255, expectedRoof & 255, 255];
    // Whole roof interior, including its triangulation diagonal, must be solid.
    for (let x = 0; x <= 16; x++) for (let z = 0; z <= 16; z++) {
      const p = new Vector3(-0.9 + x * 0.125, 1.725, -0.65 + z * 0.08).project(camera);
      const actual = pixel(rgba, Math.floor((p.x + 1) * 128), Math.floor((1 - p.y) * 128));
      expected.forEach((value, k) => expect(Math.abs(actual[k] - value)).toBeLessThan(3));
    }
  });

  it.each(["visibilityOperations", "visibilityDepth", "faces"] as const)("fails explicitly at the %s budget and permits retry", async budget => {
    const faces = new SvgFaces();
    faces.add([-1, -1, 1, -1, 0, 1, 0.5, 0, 1, 0.9, 0.1, 0.1, 1, 1, 1, 1]);
    faces.add([-1, -1, 1, -1, 0, 1, 0.6, 0, 1, 0.6, 0.6, 0.6, 1, 1, 1, 2]);
    const original = SVG_LIMITS[budget];
    try {
      Object.defineProperty(SVG_LIMITS, budget, { value: budget === "faces" ? 2 : -1, configurable: true });
      await expect(visibleOrder(faces, new Uint32Array([0, 1]), async () => {})).rejects.toMatchObject({ reason: "complex" });
    } finally { Object.defineProperty(SVG_LIMITS, budget, { value: original, configurable: true }); }
    const camera = visualCamera();
    expect(decode(await renderSvgView([projectedTriangle(camera, [[-1, -1, 0.5], [1, -1, 0.5], [0, 1, 0.5]], "red")], camera, SIZE, SIZE))).toContain("<path");
  });
});
