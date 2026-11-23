import { BoxGeometry, Group, Mesh, MeshBasicMaterial } from "three";
import { expect, it } from "vitest";
import { configureThumbnailEdges } from "./render";
import { wideLineMaterial } from "../../engine/wide-lines";

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
