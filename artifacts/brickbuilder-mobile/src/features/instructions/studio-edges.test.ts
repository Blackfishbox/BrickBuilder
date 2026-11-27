import { expect, it } from "vitest";
import { BufferGeometry, Group, Mesh } from "three";
import { wideLineMaterial } from "../engine/wide-lines";
import { configureStudioEdges } from "./studio-edges";

it("uses shared part-color contrast in Studio without overriding focus or injecting a second shader rule", () => {
  const material = wideLineMaterial();
  const mesh = new Mesh(new BufferGeometry(), material);
  mesh.userData.isWideEdgeMesh = true;
  const root = new Group().add(mesh);
  try {
    const shader = material.fragmentShader;
    expect(shader).toContain("partContrastColor(baseColor)");
    configureStudioEdges(root, 2000, 1520);
    expect(material.fragmentShader).toBe(shader);
    expect(material.uniforms.edgeContrast.value).toBe(0);
    expect(material.uniforms.lineWidth.value).toBe(4);
    configureStudioEdges(root, 160, 120);
    expect(material.fragmentShader).toBe(shader);
    expect(material.uniforms.lineWidth.value).toBe(1);
    configureStudioEdges(root, 160, 120, false);
    expect(material.fragmentShader).toBe(shader);
  } finally { material.dispose(); mesh.geometry.dispose(); }
});
