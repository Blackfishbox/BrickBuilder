import { BoxGeometry, Group, Mesh, MeshBasicMaterial } from "three";
import { expect, it } from "vitest";
import { configureThumbnailEdges, createThumbnailCamera } from "./render";
import { wideLineMaterial } from "../../engine/wide-lines";

it("preserves part proportions for print-sized landscape and portrait thumbnails", () => {
  const defaultCamera = createThumbnailCamera(10, 160, 120);
  expect(defaultCamera.left).toBeCloseTo(-14.8);
  expect(defaultCamera.right).toBeCloseTo(14.8);
  expect(defaultCamera.top).toBeCloseTo(11.1);
  expect(defaultCamera.bottom).toBeCloseTo(-11.1);

  for (const [width, height] of [[768, 240], [240, 768]]) {
    const camera = createThumbnailCamera(10, width, height);
    expect((camera.right - camera.left) / width).toBeCloseTo((camera.top - camera.bottom) / height, 8);
  }
});

it("sizes screen-space part edges to the thumbnail canvas", () => {
  const root = new Group();
  const edge = new Mesh(new BoxGeometry(), wideLineMaterial());
  edge.userData.isWideEdgeMesh = true;
  root.add(edge);

  configureThumbnailEdges(root, 160, 120);

  const uniforms = edge.material.uniforms;
  expect(uniforms.resolution.value.toArray()).toEqual([160, 120]);
  expect(uniforms.lineWidth.value).toBe(1);
});

it("does not alter ordinary part surfaces", () => {
  const root = new Group();
  const surface = new Mesh(new BoxGeometry(), new MeshBasicMaterial());
  root.add(surface);

  expect(() => configureThumbnailEdges(root, 160, 120)).not.toThrow();
});
