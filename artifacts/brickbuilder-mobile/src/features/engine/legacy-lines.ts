import { BufferAttribute, BufferGeometry, DoubleSide, ShaderMaterial, Vector2 } from "three";
import { FOCUS_FRAGMENT, FOCUS_FRAGMENT_HEADER, FOCUS_VERTEX, FOCUS_VERTEX_HEADER } from "./instruction-focus";
import { FALLBACK_EDGE_VERTEX, FALLBACK_EDGE_VERTEX_HEADER } from "./edge-contrast";

// Uniform-color WebGL lines from the renderer immediately before 0b018c5.
// No face normals or lighting attributes; contrast costs one extra byte per vertex.
export const LEGACY_EDGE_BYTES_PER_SEGMENT = 6 * (8 * Float32Array.BYTES_PER_ELEMENT + 1);

export function expandLegacyLines(source: Float32Array, stride = 1): BufferGeometry {
  const segments = Math.ceil(source.length / 6 / stride);
  const positions = new Float32Array(segments * 18);
  const opposite = new Float32Array(positions.length);
  const endpoints = new Float32Array(segments * 6);
  const sides = new Float32Array(segments * 6);
  const endpointForCorner = [0, 0, 1, 1, 0, 1];
  const sideForCorner = [-1, 1, -1, -1, 1, 1];
  let vertex = 0;
  for (let offset = 0; offset + 5 < source.length; offset += stride * 6) {
    const first = source.subarray(offset, offset + 3);
    const second = source.subarray(offset + 3, offset + 6);
    for (let corner = 0; corner < 6; corner++, vertex++) {
      const endpoint = endpointForCorner[corner];
      positions.set(endpoint ? second : first, vertex * 3);
      opposite.set(endpoint ? first : second, vertex * 3);
      endpoints[vertex] = endpoint;
      sides[vertex] = sideForCorner[corner];
    }
  }
  return new BufferGeometry()
    .setAttribute("position", new BufferAttribute(positions, 3))
    .setAttribute("lineEnd", new BufferAttribute(opposite, 3))
    .setAttribute("lineEndpoint", new BufferAttribute(endpoints, 1))
    .setAttribute("lineSide", new BufferAttribute(sides, 1))
    .setAttribute("edgeContrastOverride", new BufferAttribute(new Uint8Array(segments * 6).fill(2), 1));
}

export function legacyLineMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    transparent: true, side: DoubleSide, depthWrite: false,
    uniforms: {
      lineWidth: { value: 1 },
      resolution: { value: new Vector2(1, 1) },
      edgeOpacity: { value: 1 },
      instructionFocusEnabled: { value: false },
    },
    vertexShader: FOCUS_VERTEX_HEADER + `
      ${FALLBACK_EDGE_VERTEX_HEADER}
      attribute vec4 instanceRow0;
      attribute vec4 instanceRow1;
      attribute vec4 instanceRow2;
      attribute vec3 lineEnd;
      attribute float lineEndpoint;
      attribute float lineSide;
      uniform float lineWidth;
      uniform vec2 resolution;
      void main() {
        ${FOCUS_VERTEX}
        ${FALLBACK_EDGE_VERTEX}
        vec4 p = vec4(position, 1.0);
        vec4 q = vec4(lineEnd, 1.0);
        vec3 a = vec3(dot(instanceRow0, p), dot(instanceRow1, p), dot(instanceRow2, p));
        vec3 b = vec3(dot(instanceRow0, q), dot(instanceRow1, q), dot(instanceRow2, q));
        vec4 clipA = projectionMatrix * modelViewMatrix * vec4(a, 1.0);
        vec4 clipB = projectionMatrix * modelViewMatrix * vec4(b, 1.0);
        // Each vertex already stores its own endpoint. Keep both sides aligned
        // instead of collapsing the two quad ends onto the source start.
        vec2 delta = (clipB.xy / clipB.w - clipA.xy / clipA.w) * resolution * (1.0 - 2.0 * lineEndpoint);
        float deltaLength = length(delta);
        vec2 direction = deltaLength > 0.0001 ? delta / deltaLength : vec2(1.0, 0.0);
        vec2 normal = vec2(-direction.y, direction.x);
        vec4 clip = clipA;
        clip.xy += normal * lineSide * lineWidth / resolution * clip.w;
        clip.z -= 0.000002 * clip.w;
        gl_Position = clip;
      }`,
    fragmentShader: FOCUS_FRAGMENT_HEADER + `
      uniform bool instructionFocusEnabled;
      uniform float edgeOpacity;
      varying float vContrastInk;
      void main() {
        gl_FragColor = vec4(vec3(vContrastInk), edgeOpacity);
        if (instructionFocusEnabled && vInstructionFocus > 0.5 && vInstructionFocus < 1.5) {
          gl_FragColor.a *= 0.12;
        }
        ${FOCUS_FRAGMENT}
        #include <colorspace_fragment>
      }`,
  });
}
