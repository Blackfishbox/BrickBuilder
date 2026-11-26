import { Group, Mesh, ShaderMaterial } from "three";
import { setWideLineResolution } from "../engine/wide-lines";

/** Studio-style contrast: pale edges on black, dark edges on other plastics. */
export function configureStudioEdges(root: Group, width: number, height: number, enabled = true): void {
  root.traverse(object => {
    if (!(object instanceof Mesh) || !object.userData.isWideEdgeMesh ||
      !(object.material instanceof ShaderMaterial)) return;
    const material = object.material;
    if (!material.uniforms.pdfStudioEdges) {
      material.uniforms.pdfStudioEdges = { value: false };
      material.fragmentShader = "uniform bool pdfStudioEdges;\n" + material.fragmentShader.replace(
        "#include <colorspace_fragment>",
        `if (pdfStudioEdges) {
          float luminance = dot(baseColor, vec3(0.2126, 0.7152, 0.0722));
          gl_FragColor.rgb = luminance < 0.025 ? vec3(0.30) : vec3(0.002);
        }
        #include <colorspace_fragment>`,
      );
      material.needsUpdate = true;
    }
    material.uniforms.pdfStudioEdges.value = enabled;
    if (enabled) {
      material.uniforms.lineWidth.value = Math.max(1, width / 500);
      material.uniforms.blackLineWidth.value = 0;
      setWideLineResolution(material, width, height);
    }
  });
}
