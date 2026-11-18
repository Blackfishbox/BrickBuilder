import { Color, Group, InstancedBufferAttribute, InstancedMesh, MeshLambertMaterial, LineSegments, ShaderMaterial } from "three";

export const FOCUS_ATTRIBUTE = "instructionFocus";
export const FOCUS_VERTEX_HEADER = "attribute float instructionFocus;\nvarying float vInstructionFocus;\n";
export const FOCUS_FRAGMENT_HEADER = "varying float vInstructionFocus;\n";
export const FOCUS_VERTEX = "vInstructionFocus = instructionFocus;";
// Applied in linear space, before output conversion. Zero is exactly the normal view.
export const FOCUS_FRAGMENT = `
  if (vInstructionFocus > 0.5 && vInstructionFocus < 1.5) {
    float grey = dot(gl_FragColor.rgb, vec3(0.2126, 0.7152, 0.0722));
    gl_FragColor.rgb = mix(vec3(grey), vec3(0.72), 0.65);
  } else if (vInstructionFocus > 1.5) {
    gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(0.0, 0.65, 0.5), 0.65);
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

const focusColor = new Color("#00d3b8");
const mutedColor = new Color().setRGB(0.72, 0.72, 0.72);
/** Same contrast as WebGL, without mutating source colors or sampled geometry. */
export function instructionDisplayColor(source: Color, active: boolean): Color {
  if (active) return source.lerp(focusColor, 0.65);
  const grey = source.r * 0.2126 + source.g * 0.7152 + source.b * 0.0722;
  return source.setRGB(grey, grey, grey).lerp(mutedColor, 0.65);
}
