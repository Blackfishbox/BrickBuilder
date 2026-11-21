import { BufferAttribute, BufferGeometry, Color, ShaderMaterial, Vector2 } from "three";
import {
  FOCUS_FRAGMENT, FOCUS_FRAGMENT_HEADER, FOCUS_VERTEX, FOCUS_VERTEX_HEADER,
} from "./instruction-focus";

/**
 * Expand each source segment into two triangles. The endpoints are repeated
 * only in this render buffer; the source part geometry remains untouched.
 */
export function expandWideLines(source: Float32Array): BufferGeometry {
  const segments = Math.floor(source.length / 6);
  const positions = new Float32Array(segments * 18);
  const lineEnds = new Float32Array(positions.length);
  const endpoints = new Float32Array(segments * 6);
  const sides = new Float32Array(segments * 6);
  const endpointForVertex = [0, 0, 1, 1, 0, 1];
  const sideForVertex = [-1, 1, -1, -1, 1, 1];
  let vertex = 0;
  for (let segment = 0; segment < segments; segment++) {
    const start = source.subarray(segment * 6, segment * 6 + 3);
    const end = source.subarray(segment * 6 + 3, segment * 6 + 6);
    for (let corner = 0; corner < 6; corner++, vertex++) {
      const endpoint = endpointForVertex[corner];
      positions.set(endpoint ? end : start, vertex * 3);
      lineEnds.set(endpoint ? start : end, vertex * 3);
      endpoints[vertex] = endpoint;
      sides[vertex] = sideForVertex[corner];
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(positions, 3));
  geometry.setAttribute("lineEnd", new BufferAttribute(lineEnds, 3));
  geometry.setAttribute("lineEndpoint", new BufferAttribute(endpoints, 1));
  geometry.setAttribute("lineSide", new BufferAttribute(sides, 1));
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

export function wideLineMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: {
      lineWidth: { value: 1 },
      resolution: { value: new Vector2(1, 1) },
      edgeOpacity: { value: 0.25 },
      edgeColor: { value: new Color("#101713") },
      instructionFocusEnabled: { value: false },
    },
    vertexShader: FOCUS_VERTEX_HEADER + `
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
        vec4 p = vec4(position, 1.0);
        vec4 q = vec4(lineEnd, 1.0);
        vec3 a = vec3(dot(instanceRow0, p), dot(instanceRow1, p), dot(instanceRow2, p));
        vec3 b = vec3(dot(instanceRow0, q), dot(instanceRow1, q), dot(instanceRow2, q));
        vec4 clipA = projectionMatrix * modelViewMatrix * vec4(a, 1.0);
        vec4 clipB = projectionMatrix * modelViewMatrix * vec4(b, 1.0);
        vec2 screenA = clipA.xy / clipA.w * resolution;
        vec2 screenB = clipB.xy / clipB.w * resolution;
        vec2 delta = screenB - screenA;
        float deltaLength = length(delta);
        vec2 direction = deltaLength > 0.0001 ? delta / deltaLength : vec2(1.0, 0.0);
        vec2 normal = vec2(-direction.y, direction.x);
        vec4 clip = mix(clipA, clipB, lineEndpoint);
        clip.xy += normal * lineSide * lineWidth / resolution * clip.w;
        clip.z -= 0.0005 * clip.w;
        gl_Position = clip;
      }`,
    fragmentShader: FOCUS_FRAGMENT_HEADER + `
      uniform bool instructionFocusEnabled;
      uniform float edgeOpacity;
      uniform vec3 edgeColor;
      void main() {
        gl_FragColor = vec4(edgeColor, edgeOpacity);
        if (instructionFocusEnabled) {
          gl_FragColor = vInstructionFocus > 1.5
            ? vec4(0.6, 0.015, 0.01, 0.95)
            : vec4(vec3(0.45), 0.12);
        }
        ${FOCUS_FRAGMENT}
        #include <colorspace_fragment>
      }`,
  });
}

export function setWideLineResolution(
  material: ShaderMaterial,
  width: number,
  height: number,
): void {
  material.uniforms.resolution.value.set(Math.max(1, width), Math.max(1, height));
}

