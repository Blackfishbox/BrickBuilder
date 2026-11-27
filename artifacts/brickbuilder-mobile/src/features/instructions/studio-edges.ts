import { Group, Mesh, ShaderMaterial } from "three";
import { setWideLineResolution } from "../engine/wide-lines";

/** Studio print widths; contrast ink is shared with the builder and ordinary PDFs. */
export function configureStudioEdges(root: Group, width: number, height: number, enabled = true): void {
  if (!enabled) return;
  root.traverse(object => {
    if (!(object instanceof Mesh) || !object.userData.isWideEdgeMesh ||
      !(object.material instanceof ShaderMaterial)) return;
    const material = object.material;
    material.uniforms.lineWidth.value = Math.max(1, width / 500);
    material.uniforms.edgeContrast.value = 0;
    material.uniforms.blackLineWidth.value = 0;
    setWideLineResolution(material, width, height);
  });
}
