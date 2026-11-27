import { expect, it } from "vitest";
import { BufferGeometry, Group, Mesh } from "three";
import { wideLineMaterial } from "../engine/wide-lines";
import { configureStudioEdges } from "./studio-edges";

it("inserts Studio contrast into the real edge shader before color output, only once", () => {
  const material = wideLineMaterial();
  const mesh = new Mesh(new BufferGeometry(), material);
  mesh.userData.isWideEdgeMesh = true;
  const root = new Group().add(mesh);
  try {
    configureStudioEdges(root, 2000, 1520);
    expect(material.fragmentShader).toContain("if (pdfStudioEdges)");
    expect(material.fragmentShader.indexOf("if (pdfStudioEdges)"))
      .toBeLessThan(material.fragmentShader.indexOf("#include <colorspace_fragment>"));
    expect(material.uniforms.pdfStudioEdges.value).toBe(true);
    expect(material.uniforms.lineWidth.value).toBe(4);
    configureStudioEdges(root, 160, 120);
    expect(material.fragmentShader.match(/uniform bool pdfStudioEdges/g)).toHaveLength(1);
    expect(material.uniforms.lineWidth.value).toBe(1);
    configureStudioEdges(root, 160, 120, false);
    expect(material.uniforms.pdfStudioEdges.value).toBe(false);
  } finally { material.dispose(); mesh.geometry.dispose(); }
});
