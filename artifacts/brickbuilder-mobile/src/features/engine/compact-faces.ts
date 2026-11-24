import { BufferAttribute, BufferGeometry, Color } from "three";
import { resolveColor } from "../formats/colors";
import type { Surface } from "./ldraw-geometry";

/** Preserve position and triangle order; pack lighting normals and share identical vertices. */
export function compactFaceAttributes(geometry: BufferGeometry, surfaces: Surface[], fixedColor: boolean): void {
  const count = surfaces.reduce((total, surface) => total + surface.positions.length / 3, 0);
  const positions = new Float32Array(count * 3);
  const normals = new Int8Array(count * 3);
  const colors = fixedColor ? new Uint8Array(count * 3) : null;
  const indices = new Uint32Array(count);
  const color = new Color();
  let cursor = 0, uniqueCount = 0;
  for (const { positions: source, normals: lighting, colorCode } of surfaces) {
    color.set(resolveColor(colorCode)?.hex ?? "#ff00ff");
    // Separate maps preserve color boundaries and never share vertices from adjacent normals.
    const seen = new Map<string, number>();
    for (let i = 0; i < source.length; i += 3) {
      const x = source[i], y = source[i + 1], z = source[i + 2];
      const nx = Math.round(lighting[i] * 127), ny = Math.round(lighting[i + 1] * 127), nz = Math.round(lighting[i + 2] * 127);
      const key = `${x},${y},${z}|${nx},${ny},${nz}`;
      let index = seen.get(key);
      if (index === undefined) {
        index = uniqueCount++;
        seen.set(key, index);
        const j = index * 3;
        positions[j] = x; positions[j + 1] = y; positions[j + 2] = z;
        normals[j] = nx; normals[j + 1] = ny; normals[j + 2] = nz;
        if (colors) {
          colors[j] = Math.round(color.r * 255);
          colors[j + 1] = Math.round(color.g * 255);
          colors[j + 2] = Math.round(color.b * 255);
        }
      }
      indices[cursor++] = index;
    }
  }
  const indexBytes = uniqueCount <= 65_536 ? 2 : 4;
  const vertexBytes = colors ? 18 : 15;
  if (uniqueCount * vertexBytes + count * indexBytes < count * vertexBytes) {
    geometry.setAttribute("position", new BufferAttribute(positions.slice(0, uniqueCount * 3), 3));
    geometry.setAttribute("normal", new BufferAttribute(normals.slice(0, uniqueCount * 3), 3, true));
    if (colors) geometry.setAttribute("color", new BufferAttribute(colors.slice(0, uniqueCount * 3), 3, true));
    geometry.setIndex(new BufferAttribute(indexBytes === 2 ? new Uint16Array(indices) : indices, 1));
    return;
  }
  const flatPositions = new Float32Array(count * 3);
  const flatNormals = new Int8Array(count * 3);
  const flatColors = colors ? new Uint8Array(count * 3) : null;
  for (let i = 0; i < count; i++) {
    const from = indices[i] * 3, to = i * 3;
    for (let axis = 0; axis < 3; axis++) {
      flatPositions[to + axis] = positions[from + axis];
      flatNormals[to + axis] = normals[from + axis];
      if (flatColors && colors) flatColors[to + axis] = colors[from + axis];
    }
  }
  geometry.setAttribute("position", new BufferAttribute(flatPositions, 3));
  geometry.setAttribute("normal", new BufferAttribute(flatNormals, 3, true));
  if (flatColors) geometry.setAttribute("color", new BufferAttribute(flatColors, 3, true));
}
