import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import {
  BackSide, BufferGeometry, Color, DoubleSide, Float32BufferAttribute, Group, InstancedMesh,
  Matrix4, Mesh, MeshLambertMaterial, PerspectiveCamera, Vector3,
} from "three";
import { renderView, type ViewExportProgress } from "./view-export";
import { SVG_LIMITS, SvgBytes, SvgFaces } from "./svg-export-buffer";
import { Resvg } from "@resvg/resvg-js";
import { renderSvgView } from "./svg-view-export";
import { svgCompatibilityFixture, svgCompatibilitySamples } from "../../../test-fixtures/svg-compatibility";

function fixture(count = 1) {
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 0, 1, 0], 3));
  const material = new MeshLambertMaterial({ color: "red", side: DoubleSide });
  const model = new InstancedMesh(geometry, material, count);
  const camera = new PerspectiveCamera(42, 9 / 16, 0.1, 100);
  camera.position.z = 8;
  return { model, material, geometry, camera };
}

const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

describe("bounded progressive SVG export", () => {
  it("renders the external compatibility fixture with reused colors, alpha, depth order and clipped paths", async () => {
    const scene = svgCompatibilityFixture();
    try {
      const bytes = await renderSvgView(scene.roots, scene.camera, scene.width, scene.height);
      const svg = decode(bytes);
      expect(svg).toBe((await readFile(new URL("../../../test-fixtures/svg-compatibility.svg", import.meta.url), "utf8")).trimEnd());
      expect(await renderSvgView(scene.roots, scene.camera, scene.width, scene.height)).toEqual(bytes);
      const definitions = [...svg.matchAll(/<path id="([^"]+)" d="([^"]+)"/g)];
      const uses = [...svg.matchAll(/<use href="#([^"]+)"[^>]*\/>/g)];
      expect(uses.length).toBeGreaterThanOrEqual(4);
      expect(new Set(definitions.map(match => match[1])).size).toBe(definitions.length);
      for (const use of uses) expect(definitions.some(def => def[1] === use[1])).toBe(true);
      // Two coincident layers really reference the same vectors, not copied paths.
      expect(uses.some((use, i) => uses.slice(i + 1).some(other => other[1] === use[1] && other[0] !== use[0]))).toBe(true);
      expect(svg).not.toMatch(/<image|<rect|<foreignObject|data:image/);
      const { pixels } = new Resvg(svg).render();
      for (const sample of svgCompatibilitySamples) {
        const offset = (sample.y * scene.width + sample.x) * 4;
        sample.rgba.forEach((expected, channel) => {
          if (sample.rgba[3] === 0 && channel < 3) return;
          // resvg exposes premultiplied RGBA, unlike decoded PNG samples.
          const actual = channel < 3 ? pixels[offset + channel] * 255 / pixels[offset + 3] : pixels[offset + channel];
          expect(Math.abs(actual - expected), sample.name).toBeLessThanOrEqual(2);
        });
      }
    } finally { scene.dispose(); }
  });

  it("keeps the raised SVG workload and memory ceilings explicit", () => {
    expect(SVG_LIMITS).toMatchObject({
      faces: 900_000,
      inputTriangles: 10_000_000,
      outputBytes: 32 * 1024 * 1024,
      reuseEntries: 4096,
      visibilityOperations: 96_000_000,
      visibilityDepth: 256,
    });
  });

  it("exports 160,001 real triangles while other tasks run, reusing identical vectors", async () => {
    const { model, camera } = fixture(160_001);
    const progress: ViewExportProgress[] = [];
    let heartbeats = 0;
    const timer = setInterval(() => heartbeats++, 1);
    try {
      const svg = decode(await renderView([model], camera, "svg", { onProgress: value => progress.push(value) }));
      expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
      expect(svg.endsWith("</svg>")).toBe(true);
      expect(svg).toContain('width="2160" height="3840"');
      expect(svg).toContain("background-color:transparent");
      expect(svg.match(/<use /g)).toHaveLength(160_001);
      expect(svg.match(/<path /g)).toHaveLength(1);
      expect(svg).not.toMatch(/<image|<rect|data:image|<foreignObject/);
      expect(new Set(progress.map(value => value.phase))).toEqual(new Set(["project", "sort", "visibility", "write"]));
      expect(progress.at(-1)).toEqual({ phase: "write", completed: 160_001, total: 160_001 });
      expect(heartbeats).toBeGreaterThan(10);
      expect(model.count).toBe(160_001);
    } finally { clearInterval(timer); }
  }, 30_000);

  it.each(["project", "sort", "visibility", "write"] as const)("can cancel during %s and immediately start again", async phase => {
    const { model, camera } = fixture(1024);
    const controller = new AbortController();
    await expect(renderView([model], camera, "svg", {
      signal: controller.signal,
      onProgress: value => {
        if (value.phase === phase) setTimeout(() => controller.abort(), 0);
      },
    })).rejects.toMatchObject({ reason: "cancelled" });
    model.count = 1;
    expect(decode(await renderView([model], camera, "svg"))).toContain("<path");
  });

  it("honors cancellation before starting without visiting any geometry", async () => {
    const controller = new AbortController(); controller.abort();
    const { model, camera } = fixture();
    model.updateWorldMatrix = () => { throw new Error("must not visit"); };
    await expect(renderView([model], camera, "svg", { signal: controller.signal })).rejects.toMatchObject({ reason: "cancelled" });
  });

  it("keeps nested world transforms, a parented off-axis camera and its projection", async () => {
    const { model, camera } = fixture();
    camera.position.z = 10;
    const parent = new Group(); parent.position.set(0.2, 0.5, -0.3);
    const child = new Group(); child.rotation.y = 0.2; child.add(model); parent.add(child);
    model.setMatrixAt(0, new Matrix4().makeTranslation(0.4, -0.2, 0));
    const rig = new Group(); rig.position.x = 0.3; rig.add(camera);
    camera.filmOffset = 2; camera.zoom = 1.2; camera.updateProjectionMatrix();
    parent.updateMatrixWorld(true); rig.updateMatrixWorld(true);
    const pose = camera.matrixWorld.clone(), projection = camera.projectionMatrix.clone();
    const point = new Vector3(-1 + 0.4, -1 - 0.2, 0).applyMatrix4(model.matrixWorld).project(camera);
    const svg = decode(await renderView([parent], camera, "svg"));
    expect(svg).toContain(`M${Number((point.x * 1080).toFixed(2))},${Number((-point.y * 1920).toFixed(2))}`);
    expect(camera.matrixWorld.equals(pose)).toBe(true);
    expect(camera.projectionMatrix.equals(projection)).toBe(true);
    expect(model.parent).toBe(child);
  });

  it("preserves colors on reused transparent faces and painter order", async () => {
    const { model, camera, material } = fixture(2);
    material.opacity = 0.4; material.transparent = true;
    model.setColorAt(0, new Color("red"));
    material.color.set("white");
    model.setColorAt(1, new Color("blue"));
    const svg = decode(await renderView([model], camera, "svg"));
    expect(svg.match(/<use /g)).toHaveLength(2);
    expect(svg.match(/fill-opacity="0.4"/g)).toHaveLength(2);
    expect(svg).toMatch(/<defs><path id="f0" d="[^"]+"\/><\/defs>/);
    expect(svg).toMatch(/fill="#[0-9a-f]{2}0000"/);
    expect(svg).toMatch(/fill="#0000[0-9a-f]{2}"/);
    const farther = new Mesh(model.geometry, new MeshLambertMaterial({ color: "green", side: DoubleSide }));
    farther.position.z = -1;
    const sorted = decode(await renderView([model, farther], camera, "svg"));
    expect(sorted.indexOf('fill="#00')).toBeLessThan(sorted.indexOf('fill-opacity="0.4"'));
  });

  it("clips triangles crossing the near plane and excludes faces outside the viewport", async () => {
    const { model, camera, geometry } = fixture();
    camera.position.z = 0;
    geometry.setAttribute("position", new Float32BufferAttribute([-0.1, -0.1, -1, 0.1, -0.1, -1, 0, 0.1, 0.2], 3));
    const svg = decode(await renderView([model], camera, "svg"));
    expect(svg).toContain("<path");
    expect(svg).not.toMatch(/NaN|Infinity/);
    const coords = [...svg.matchAll(/d="([^"]+)"/g)].filter(match => match[1].startsWith("M"))
      .flatMap(match => match[1].match(/-?\d+(?:\.\d+)?/g)!.map(Number));
    expect(coords.length).toBeGreaterThan(0);
    coords.forEach((value, index) => expect(Math.abs(value)).toBeLessThanOrEqual(index % 2 ? 1920 : 1080));
    model.position.x = 100;
    expect(decode(await renderView([model], camera, "svg"))).not.toContain("<path");
  });

  it("honors indices, draw ranges, material groups, visibility and back faces", async () => {
    const { geometry, camera } = fixture();
    geometry.setIndex([0, 1, 2, 0, 1, 2]);
    geometry.addGroup(0, 3, 0); geometry.addGroup(3, 3, 1);
    geometry.setDrawRange(3, 3);
    const materials = [new MeshLambertMaterial({ color: "red" }), new MeshLambertMaterial({ color: "blue" })];
    const mesh = new Mesh(geometry, materials);
    let svg = decode(await renderView([mesh], camera, "svg"));
    expect(svg).toMatch(/fill="#0000[0-9a-f]{2}"/);
    materials[1].side = BackSide;
    svg = decode(await renderView([mesh], camera, "svg"));
    expect(svg).not.toContain("<path");
    materials[1].visible = false;
    await expect(renderView([mesh], camera, "svg")).rejects.toMatchObject({ reason: "empty" });
  });

  it("stops at the bounded face and output budgets with an explicit error", () => {
    const faces = new SvgFaces();
    // Exercise the guard without retaining hundreds of thousands of fixture faces.
    faces.count = SVG_LIMITS.faces;
    expect(() => faces.add([0, 0, 1, 0, 0, 1, 0, 0, 1])).toThrow("complex");
    const output = new SvgBytes();
    const chunk = "x".repeat(32 * 1024);
    for (let size = 0; size < SVG_LIMITS.outputBytes; size += chunk.length) output.append(chunk);
    expect(() => output.append("x")).toThrow("complex");
  });

  it("exports a reproducible detailed mesh with 160,001 distinct visible triangles", async () => {
    const { camera, material } = fixture();
    const count = 160_001;
    const positions = new Float32Array(count * 9);
    for (let index = 0; index < count; index++) {
      const x = (index % 401) / 200.5 - 1, y = Math.floor(index / 401) / 200 - 1;
      positions.set([x, y, 0, x + 0.004, y, 0, x, y + 0.004, 0], index * 9);
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
    let ticks = 0;
    const timer = setInterval(() => ticks++, 1);
    try {
      const svg = decode(await renderView([new Mesh(geometry, material)], camera, "svg"));
      // Coplanar triangles share paths to eliminate internal antialiasing seams.
      expect(svg.match(/M/g)?.length).toBe(count);
      expect(svg).not.toMatch(/<image|data:image/);
      expect(svg.endsWith("</svg>")).toBe(true);
      expect(svg.length).toBeLessThanOrEqual(SVG_LIMITS.outputBytes);
      expect(ticks).toBeGreaterThan(10);
    } finally { clearInterval(timer); }
  }, 30_000);
});
