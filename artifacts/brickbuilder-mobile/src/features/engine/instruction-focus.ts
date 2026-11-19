import { Color, Group, InstancedBufferAttribute, InstancedMesh, MeshLambertMaterial, LineSegments, ShaderMaterial } from "three";

export const FOCUS_ATTRIBUTE = "instructionFocus";
export const FOCUS_VERTEX_HEADER = "attribute float instructionFocus;\nvarying float vInstructionFocus;\n";
export const FOCUS_FRAGMENT_HEADER = "varying float vInstructionFocus;\n";
export const FOCUS_VERTEX = "vInstructionFocus = instructionFocus;";
// Applied in linear space, before output conversion. Zero is exactly the normal view.
export const FOCUS_FRAGMENT = `
  if (vInstructionFocus > 0.5 && vInstructionFocus < 1.5) {
    gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(1.0), 0.1);
  } else if (vInstructionFocus > 1.5) {
    // Active parts retain their original colors; the overlay draws red bounds.
  }
`;

/** One float per existing instance slot, not one mesh/material/draw per occurrence. */
export function installInstructionFocus(mesh: InstancedMesh): void {
  mesh.geometry.setAttribute(FOCUS_ATTRIBUTE, new InstancedBufferAttribute(new Float32Array(mesh.instanceMatrix.count), 1));
  const material = mesh.material as MeshLambertMaterial;
  material.onBeforeCompile = shader => {
    shader.vertexShader = FOCUS_VERTEX_HEADER + shader.vertexShader.replace("#include <begin_vertex>", `#include <begin_vertex>\n${FOCUS_VERTEX}`);
    shader.fragmentShader = FOCUS_FRAGMENT_HEADER + shader.fragmentShader.replace("#include <colorspace_fragment>", `${FOCUS_FRAGMENT}\n#include <colorspace_fragment>`);
  };
  material.customProgramCacheKey = () => "instruction-focus-v1";
}

/**
 * Presentation only. Undefined disables; an empty set dims every visible part.
 * Slot IDs come from the renderer, so repeated catalog references remain distinct.
 * Reuses attributes on toggles; also handles incremental batch growth/swap deletion.
 */
export function applyInstructionFocus(root: Group | null, current?: ReadonlySet<string>): void {
  if (!root) return;
  for (const draw of root.children) {
    if (!(draw instanceof InstancedMesh || draw instanceof LineSegments)) continue;
    const ids = draw.userData.brickIds as string[] | undefined;
    if (!ids) continue;
    const size = draw instanceof InstancedMesh ? draw.instanceMatrix.count : draw.geometry.getAttribute("instanceRow0")?.count;
    if (size === undefined) continue;
    let attribute = draw.geometry.getAttribute(FOCUS_ATTRIBUTE) as InstancedBufferAttribute | undefined;
    if (!attribute || attribute.count < size) {
      attribute = new InstancedBufferAttribute(new Float32Array(size), 1);
      draw.geometry.setAttribute(FOCUS_ATTRIBUTE, attribute);
    }
    let changed = false;
    ids.forEach((id, slot) => {
      const value = current === undefined ? 0 : current.has(id) ? 2 : 1;
      if (attribute!.getX(slot) !== value) { attribute!.setX(slot, value); changed = true; }
    });
    if (changed) attribute.needsUpdate = true;
    if (draw instanceof LineSegments && draw.material instanceof ShaderMaterial) {
      draw.material.uniforms.instructionFocusEnabled.value = current !== undefined;
    }
  }
}

const mutedColor = new Color("#ffffff");
/** Same contrast as WebGL, without mutating source colors or sampled geometry. */
export function instructionDisplayColor(source: Color, active: boolean): Color {
  return active ? source : source.lerp(mutedColor, 0.1);
}
