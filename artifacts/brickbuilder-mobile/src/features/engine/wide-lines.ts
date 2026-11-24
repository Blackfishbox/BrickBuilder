import { BufferAttribute, BufferGeometry, Color, DoubleSide, LessEqualDepth, ShaderMaterial, Vector2, Vector3 } from "three";
import {
  FOCUS_FRAGMENT, FOCUS_FRAGMENT_HEADER, FOCUS_VERTEX, FOCUS_VERTEX_HEADER,
} from "./instruction-focus";
import { BUILDER_LIGHTING } from "./lighting";

/** A deliberately obvious outline width when the user enables thick edges. */
export const THICK_EDGE_WIDTH_PX = 5.5;
/** Subtle hue-preserving contrast so touching pieces remain distinguishable. */
export const NORMAL_EDGE_CONTRAST = 0.68;

export interface LineNormalPairs {
  primary: Float32Array;
  alternate: Float32Array;
}

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

/** Keep both faces meeting at each edge so the renderer can shade the visible one. */
export function deriveLineNormalPairs(
  lines: Float32Array,
  positions: Float32Array,
  normals: Float32Array,
): LineNormalPairs {
  const key = (data: Float32Array, offset: number) =>
    `${Math.round(data[offset] * 100_000)},${Math.round(data[offset + 1] * 100_000)},${Math.round(data[offset + 2] * 100_000)}`;
  type Pair = { low: [number, number, number]; high: [number, number, number] };
  const candidates = new Map<string, Pair[]>();
  const normalAt = (offset: number): [number, number, number] => {
    const value = [normals[offset], normals[offset + 1], normals[offset + 2]] as [number, number, number];
    const length = Math.hypot(...value) || 1;
    return [value[0] / length, value[1] / length, value[2] / length];
  };
  const pointKey = (offset: number) =>
    `${Math.round(positions[offset] * 100_000)},${Math.round(positions[offset + 1] * 100_000)},${Math.round(positions[offset + 2] * 100_000)}`;
  for (let offset = 0; offset + 8 < positions.length && offset + 8 < normals.length; offset += 9) {
    for (const [first, second] of [[0, 3], [3, 6], [6, 0]]) {
      const firstKey = pointKey(offset + first), secondKey = pointKey(offset + second);
      if (firstKey === secondKey) continue;
      const lowFirst = firstKey < secondKey;
      const low = normalAt(offset + (lowFirst ? first : second));
      const high = normalAt(offset + (lowFirst ? second : first));
      const edgeKey = lowFirst ? `${firstKey}|${secondKey}` : `${secondKey}|${firstKey}`;
      const list = candidates.get(edgeKey) ?? [];
      const duplicate = list.some(pair =>
        pair.low.every((value, index) => Math.abs(value - low[index]) < 1e-4) &&
        pair.high.every((value, index) => Math.abs(value - high[index]) < 1e-4));
      if (!duplicate) list.push({ low, high });
      candidates.set(edgeKey, list);
    }
  }
  const fallback = deriveLineNormals(lines, positions, normals);
  const primary = new Float32Array(lines.length);
  const alternate = new Float32Array(lines.length);
  for (let offset = 0; offset + 5 < lines.length; offset += 6) {
    const firstKey = key(lines, offset), secondKey = key(lines, offset + 3);
    const lowFirst = firstKey < secondKey;
    const list = candidates.get(lowFirst ? `${firstKey}|${secondKey}` : `${secondKey}|${firstKey}`);
    for (const [endpoint, pointKeyValue] of [[0, firstKey], [3, secondKey]] as const) {
      const lowEndpoint = pointKeyValue === (lowFirst ? firstKey : secondKey);
      const firstNormal = list?.[0] ? (lowEndpoint ? list[0].low : list[0].high) : [...fallback.subarray(offset + endpoint, offset + endpoint + 3)] as [number, number, number];
      const secondNormal = list?.[1] ? (lowEndpoint ? list[1].low : list[1].high) : firstNormal;
      primary.set(firstNormal, offset + endpoint);
      alternate.set(secondNormal, offset + endpoint);
    }
  }
  return { primary, alternate };
}

/**
 * Expand each source segment into two triangles. The endpoints are repeated
 * only in this render buffer; the source part geometry remains untouched.
 */
export function expandWideLines(
  source: Float32Array,
  sourceNormals?: Float32Array,
  sourceAlternateNormals?: Float32Array,
): BufferGeometry {
  const segments = Math.floor(source.length / 6);
  const positions = new Float32Array(segments * 18);
  const lineEnds = new Float32Array(positions.length);
  const endpoints = new Float32Array(segments * 6);
  const sides = new Float32Array(segments * 6);
  const normals = sourceNormals ? new Float32Array(positions.length) : undefined;
  const alternateNormals = sourceNormals ? new Float32Array(positions.length) : undefined;
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
      if (alternateNormals && sourceNormals) alternateNormals.set(
        (sourceAlternateNormals ?? sourceNormals).subarray(segment * 6 + endpoint * 3, segment * 6 + endpoint * 3 + 3),
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
  if (alternateNormals) geometry.setAttribute("edgeAlternateNormal", new BufferAttribute(alternateNormals, 3));
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
    transparent: true,
    // Screen-space quads face either direction depending on the source edge.
    side: DoubleSide,
    // Draw after solid and translucent part surfaces, but keep hidden edges occluded.
    depthTest: true,
    depthFunc: LessEqualDepth,
    depthWrite: false,
    uniforms: {
      lineWidth: { value: 1 },
      edgeContrast: { value: 1 },
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
      attribute vec3 edgeAlternateNormal;
      attribute vec3 lineEnd;
      attribute float lineEndpoint;
      attribute float lineSide;
      uniform float lineWidth;
      uniform vec2 resolution;
      varying float vLineSide;
      varying vec3 vEdgeColor;
      varying vec3 vInstanceEdgeColor;
      varying vec3 vEdgeNormal;
      varying vec3 vEdgeAlternateNormal;
      varying float vEdgeFacing;
      varying float vEdgeAlternateFacing;
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
          dot(instanceRow0.xyz, normal),
          dot(instanceRow1.xyz, normal),
          dot(instanceRow2.xyz, normal)
        ));
        vec3 alternateNormal = length(edgeAlternateNormal) > 0.0001
          ? normalize(edgeAlternateNormal) : normal;
        vEdgeAlternateNormal = normalize(vec3(
          dot(instanceRow0.xyz, alternateNormal),
          dot(instanceRow1.xyz, alternateNormal),
          dot(instanceRow2.xyz, alternateNormal)
        ));
        vEdgeFacing = (viewMatrix * vec4(vEdgeNormal, 0.0)).z;
        vEdgeAlternateFacing = (viewMatrix * vec4(vEdgeAlternateNormal, 0.0)).z;
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
      uniform float edgeContrast;
      uniform float hemisphereGround;
      uniform float hemisphereIntensity;
      uniform vec3 sunDirection;
      uniform float sunIntensity;
      varying float vLineSide;
      varying vec3 vEdgeColor;
      varying vec3 vInstanceEdgeColor;
      varying vec3 vEdgeNormal;
      varying vec3 vEdgeAlternateNormal;
      varying float vEdgeFacing;
      varying float vEdgeAlternateFacing;
      varying float vEdgeUseInstanceColor;
      void main() {
        vec3 visibleNormal = vEdgeFacing >= vEdgeAlternateFacing
          ? normalize(vEdgeNormal) : normalize(vEdgeAlternateNormal);
        float skyWeight = (visibleNormal.y + 1.0) * 0.5;
        float hemisphere = mix(hemisphereGround, 1.0, skyWeight) * hemisphereIntensity;
        float sunlight = max(0.0, dot(visibleNormal, normalize(sunDirection))) * sunIntensity;
        vec3 baseColor = mix(vEdgeColor, vInstanceEdgeColor, vEdgeUseInstanceColor);
        float edgeWidth = max(fwidth(vLineSide), 0.0001);
        float coverage = 1.0 - smoothstep(1.0 - edgeWidth, 1.0, abs(vLineSide));
        gl_FragColor = vec4(baseColor * (hemisphere + sunlight) * edgeContrast, coverage);
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

