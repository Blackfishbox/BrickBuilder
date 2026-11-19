import { BoxGeometry, Matrix4, Vector3 } from "three";
import { parseLDraw } from "../formats/ldraw/parser";
import type { Affine, ImportedModel } from "../formats/types";

/** Synthetic licensed geometry only; dimensions are in studs, source Y down. */
export function solidBox(min: number[], max: number[], transform = new Matrix4()): string {
  const size = new Vector3(...max).sub(new Vector3(...min));
  const center = new Vector3(...max).add(new Vector3(...min)).multiplyScalar(0.5);
  const geometry = new BoxGeometry(size.x, size.y, size.z).toNonIndexed();
  const positions = geometry.getAttribute("position");
  const lines: string[] = [];
  for (let i = 0; i < positions.count; i += 3) {
    const points = [0, 1, 2].flatMap(offset => new Vector3().fromBufferAttribute(positions, i + offset)
      .add(center).applyMatrix4(transform).multiplyScalar(20).toArray());
    lines.push(`3 16 ${points.join(" ")}`);
  }
  geometry.dispose();
  return lines.join("\n");
}

export const identity: Affine = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0];
export function collisionFixture(parts: Record<string, string>, references: string[]): ImportedModel {
  const sourceText = references.map((reference, i) =>
    `1 4 ${i * 200} 0 0 1 0 0 0 1 0 0 0 1 ${reference}`).join("\n");
  const model: ImportedModel = {
    version: 1, format: "ldr", sourceName: "synthetic.ldr", sourceText, originalBytes: [],
    ...parseLDraw(sourceText), legalDocuments: [],
    resources: Object.fromEntries(Object.entries(parts).map(([reference, content]) => {
      const path = `parts/${reference}`;
      return [path, { path, content, author: "Synthetic fixture", license: "CC0-1.0" as const, sourceUrl: "https://example.invalid" }];
    })),
  };
  model.instances.forEach(instance => { instance.part.status = "resolved"; });
  return model;
}

/** An inverted cup: connected walls and roof; open underside, closed material. */
export function hollowCup(): string {
  // A 4x4 square annulus extruded along Y, with its opening at Y=0.
  const outer = [[-2, -2], [2, -2], [2, 2], [-2, 2]];
  const inner = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  const lines: string[] = [];
  const quad = (vs: number[][]) => lines.push(`4 16 ${vs.flatMap(v => v.map(n => n * 20)).join(" ")}`);
  const at = (v: number[], y: number) => [v[0], y, v[1]];
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4, o = outer[i], p = outer[j], a = inner[i], b = inner[j];
    quad([at(o, 0), at(p, 0), at(p, -3), at(o, -3)]);
    quad([at(a, 0), at(a, -2), at(b, -2), at(b, 0)]);
    quad([at(o, 0), at(a, 0), at(b, 0), at(p, 0)]);
  }
  // Separate inner ceiling and outer roof close the material boundary.
  quad(inner.map(v => at(v, -2)));
  quad(outer.map(v => at(v, -3)));
  return lines.join("\n");
}
