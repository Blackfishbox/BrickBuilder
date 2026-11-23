import { BufferAttribute, BufferGeometry, Color, DoubleSide, LessEqualDepth, ShaderMaterial, Vector2, Vector3 } from "three";
import {
  FOCUS_FRAGMENT, FOCUS_FRAGMENT_HEADER, FOCUS_VERTEX, FOCUS_VERTEX_HEADER,
} from "./instruction-focus";
import { BUILDER_LIGHTING } from "./lighting";

/** A deliberately obvious outline width when the user enables thick edges. */
export const THICK_EDGE_WIDTH_PX = 4.5;

/** Match line endpoints to the average normals of coincident surface vertices. */
export function deriveLineNormals(
  lines: Float32Array,
  positions: Float32Array,
  normals: Float32Array,
): Float32Array {
  const sums = new Map<string, [number, number, number, number]>();
  const key = (x: number, y: number, z: number) =>
    `${Math.round(x * 100_000)},${Math.round(y * 100_000)},${Math.round(z * 100_000)}`;
  for (let offset = 0; offset + 2 < positions.length && offset + 2 < normals.length; offset += 3) {
    const id = key(positions[offset], positions[offset + 1], positions[offset + 2]);
    const sum = sums.get(id) ?? [0, 0, 0, 0];
    sum[0] += normals[offset]; sum[1] += normals[offset + 1]; sum[2] += normals[offset + 2]; sum[3]++;
    sums.set(id, sum);
  }
  const result = new Float32Array(lines.length);
  for (let offset = 0; offset + 2 < lines.length; offset += 3) {
    const sum = sums.get(key(lines[offset], lines[offset + 1], lines[offset + 2]));
    if (!sum) {
      result[offset + 1] = 1;
      continue;
    }
    const length = Math.hypot(sum[0], sum[1], sum[2]) || sum[3];
    result[offset] = sum[0] / length;
    result[offset + 1] = sum[1] / length;
    result[offset + 2] = sum[2] / length;
  }
  return result;
}

/**
 * Expand each source segment into two triangles. The endpoints are repeated
 * only in this render buffer; the source part geometry remains untouched.
 */
export function expandWideLines(source: Float32Array, sourceNormals?: Float32Array): BufferGeometry {
  const segments = Math.floor(source.length / 6);
  const positions = new Float32Array(segments * 18);
  const lineEnds = new Float32Array(positions.length);
  const endpoints = new Float32Array(segments * 6);
  const sides = new Float32Array(segments * 6);
  const normals = sourceNormals ? new Float32Array(positions.length) : undefined;
  const baseColors = new Float32Array(positions.length);
  const useInstanceColor = new Float32Array(segments * 6);
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
      baseColors.set([1, 1, 1], vertex * 3);
      useInstanceColor[vertex] = 1;
      if (normals && sourceNormals) normals.set(
        sourceNormals.subarray(segment * 6 + endpoint * 3, segment * 6 + endpoint * 3 + 3),
        vertex * 3,
      );
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(positions, 3));
  geometry.setAttribute("lineEnd", new BufferAttribute(lineEnds, 3));
  geometry.setAttribute("lineEndpoint", new BufferAttribute(endpoints, 1));
  geometry.setAttribute("lineSide", new BufferAttribute(sides, 1));
  if (normals) geometry.setAttribute("edgeNormal", new BufferAttribute(normals, 3));
  geometry.setAttribute("edgeBaseColor", new BufferAttribute(baseColors, 3));
  geometry.setAttribute("edgeUseInstanceColor", new BufferAttribute(useInstanceColor, 1));
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

export function wideLineMaterial(): ShaderMaterial {
  const ground = new Color(BUILDER_LIGHTING.ground);
  const sunDirection = new Vector3(...BUILDER_LIGHTING.direction).normalize();
  return new ShaderMaterial({
    transparent: false,
    // Screen-space quads face either direction depending on the source edge.
    side: DoubleSide,
    // Draw after solid and translucent part surfaces, but keep hidden edges occluded.
    depthTest: true,
    depthFunc: LessEqualDepth,
    depthWrite: false,
    uniforms: {
      lineWidth: { value: 1 },
      resolution: { value: new Vector2(1, 1) },
      instructionFocusEnabled: { value: false },
      hemisphereGround: { value: ground.r },
      hemisphereIntensity: { value: BUILDER_LIGHTING.hemisphere },
      sunDirection: { value: sunDirection },
      sunIntensity: { value: BUILDER_LIGHTING.sun },
    },
    vertexShader: FOCUS_VERTEX_HEADER + `
      attribute vec4 instanceRow0;
      attribute vec4 instanceRow1;
      attribute vec4 instanceRow2;
      attribute vec3 instanceEdgeColor;
      attribute vec3 edgeBaseColor;
      attribute float edgeUseInstanceColor;
      attribute vec3 edgeNormal;
      attribute vec3 lineEnd;
      attribute float lineEndpoint;
      attribute float lineSide;
      uniform float lineWidth;
      uniform vec2 resolution;
      varying float vLineSide;
      varying vec3 vEdgeColor;
      varying vec3 vInstanceEdgeColor;
      varying vec3 vEdgeNormal;
      varying float vEdgeUseInstanceColor;
      vec3 edgeColorToLinear(vec3 color) {
        vec3 low = color / 12.92;
        vec3 high = pow((color + vec3(0.055)) / 1.055, vec3(2.4));
        return mix(high, low, lessThanEqual(color, vec3(0.04045)));
      }
      void main() {
        ${FOCUS_VERTEX}
        vEdgeColor = edgeBaseColor;
        vInstanceEdgeColor = edgeColorToLinear(instanceEdgeColor);
        vEdgeUseInstanceColor = edgeUseInstanceColor;
        vec3 normal = length(edgeNormal) > 0.0001 ? normalize(edgeNormal) : vec3(0.0, 1.0, 0.0);
        vEdgeNormal = normalize(vec3(
          dot(vec3(instanceRow0.x, instanceRow1.x, instanceRow2.x), normal),
          dot(vec3(instanceRow0.y, instanceRow1.y, instanceRow2.y), normal),
          dot(vec3(instanceRow0.z, instanceRow1.z, instanceRow2.z), normal)
        ));
        vLineSide = lineSide;
        vec4 p = vec4(position, 1.0);
        vec4 q = vec4(lineEnd, 1.0);
        vec3 a = vec3(dot(instanceRow0, p), dot(instanceRow1, p), dot(instanceRow2, p));
        vec3 b = vec3(dot(instanceRow0, q), dot(instanceRow1, q), dot(instanceRow2, q));
        vec4 clipA = projectionMatrix * modelViewMatrix * vec4(a, 1.0);
        vec4 clipB = projectionMatrix * modelViewMatrix * vec4(b, 1.0);
        vec2 screenA = clipA.xy / clipA.w * resolution;
        vec2 screenB = clipB.xy / clipB.w * resolution;
        // position is already this vertex's endpoint; lineEnd is the opposite.
        // Keep the normal consistent at both ends instead of folding the quad.
        vec2 delta = (screenB - screenA) * (1.0 - 2.0 * lineEndpoint);
        float deltaLength = length(delta);
        vec2 direction = deltaLength > 0.0001 ? delta / deltaLength : vec2(1.0, 0.0);
        vec2 screenNormal = vec2(-direction.y, direction.x);
        vec4 clip = clipA;
        clip.xy += screenNormal * lineSide * lineWidth / resolution * clip.w;
        gl_Position = clip;
      }`,
    fragmentShader: FOCUS_FRAGMENT_HEADER + `
      uniform bool instructionFocusEnabled;
      uniform float hemisphereGround;
      uniform float hemisphereIntensity;
      uniform vec3 sunDirection;
      uniform float sunIntensity;
      varying float vLineSide;
      varying vec3 vEdgeColor;
      varying vec3 vInstanceEdgeColor;
      varying vec3 vEdgeNormal;
      varying float vEdgeUseInstanceColor;
      void main() {
        float skyWeight = (vEdgeNormal.y + 1.0) * 0.5;
        float hemisphere = mix(hemisphereGround, 1.0, skyWeight) * hemisphereIntensity;
        float sunlight = max(0.0, dot(normalize(vEdgeNormal), normalize(sunDirection))) * sunIntensity;
        vec3 baseColor = mix(vEdgeColor, vInstanceEdgeColor, vEdgeUseInstanceColor);
        gl_FragColor = vec4(baseColor * (hemisphere + sunlight), 1.0);
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

