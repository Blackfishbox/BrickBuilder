// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import {
  BoxGeometry, Color, Group, InstancedMesh, Matrix4, Mesh, MeshLambertMaterial,
  PerspectiveCamera, Scene,
} from "three";
import { renderView, triangleCount, viewExportSize } from "./view-export";

function sample() {
  const geometry = new BoxGeometry();
  const material = new MeshLambertMaterial({ color: "white" });
  const mesh = new InstancedMesh(geometry, material, 2);
  mesh.setMatrixAt(0, new Matrix4().makeTranslation(-1, 0, 0));
  mesh.setMatrixAt(1, new Matrix4().makeTranslation(1, 0, 0));
  mesh.setColorAt(0, new Color("red"));
  mesh.setColorAt(1, new Color("blue"));
  const root = new Group();
  root.position.set(0, 3, 0);
  root.add(mesh);
  return { root, mesh, geometry, material };
}

describe("current view image export", () => {
  it("keeps the full viewport and makes its longest edge exactly 4K", () => {
    expect(viewExportSize(16 / 9)).toEqual({ width: 3840, height: 2160 });
    expect(viewExportSize(9 / 16)).toEqual({ width: 2160, height: 3840 });
    expect(viewExportSize(1)).toEqual({ width: 3840, height: 3840 });
    expect(() => viewExportSize(0)).toThrow("unavailable");
    expect(() => viewExportSize(Number.NaN)).toThrow("unavailable");
  });

  it("exports instanced faces with distinct colors without expanding the source", async () => {
    const { root, mesh } = sample();
    expect(triangleCount([root])).toBe(24);
    const camera = new PerspectiveCamera(42, 1, 0.1, 100);
    camera.position.set(5, 6, 10); camera.lookAt(0, 3, 0);
    const text = new TextDecoder().decode(await renderView([root], camera, "svg"));
    const svg = new DOMParser().parseFromString(text, "image/svg+xml");
    const fills = [...svg.querySelectorAll("[fill]")].map(node => node.getAttribute("fill")!);
    expect(fills.some(fill => /^#[a-f0-9]{2}0000$/.test(fill))).toBe(true);
    expect(fills.some(fill => /^#0000[a-f0-9]{2}$/.test(fill))).toBe(true);
    expect(root.children).toEqual([mesh]);
    expect(root.position.y).toBe(3);
  });

  it("excludes hidden meshes and fails explicitly for empty geometry", async () => {
    const { root, mesh } = sample();
    mesh.visible = false;
    expect(triangleCount([root])).toBe(0);
    await expect(renderView([root], new PerspectiveCamera(), "svg")).rejects.toThrow("empty");
  });

  it("writes real SVG paths, keeps camera pose and excludes other scene objects", async () => {
    const { root, mesh, geometry, material } = sample();
    const disposeGeometry = vi.spyOn(geometry, "dispose");
    const disposeMaterial = vi.spyOn(material, "dispose");
    const scene = new Scene();
    const floor = new Mesh(new BoxGeometry(100, 1, 100), new MeshLambertMaterial({ color: "green" }));
    floor.name = "construction-floor";
    scene.add(root, floor);
    const camera = new PerspectiveCamera(42, 16 / 9, 0.1, 100);
    camera.position.set(5, 6, 10);
    camera.lookAt(0, 3, 0);
    const position = camera.position.clone(), rotation = camera.quaternion.clone();
    const projection = camera.projectionMatrix.clone();
    const svg = new TextDecoder().decode(await renderView([root], camera, "svg"));
    expect(svg).toContain("<svg");
    expect(svg).toContain("<path");
    expect(svg).toContain('width="3840"');
    expect(svg).toContain('height="2160"');
    expect(svg).toContain("transparent");
    expect(svg).not.toContain("<image");
    expect(svg).not.toContain("<rect");
    expect(camera.position.equals(position)).toBe(true);
    expect(camera.quaternion.equals(rotation)).toBe(true);
    expect(camera.projectionMatrix.equals(projection)).toBe(true);
    expect(mesh.count).toBe(2);
    expect(root.parent).toBe(scene);
    expect(disposeGeometry).not.toHaveBeenCalled();
    expect(disposeMaterial).not.toHaveBeenCalled();
  });
});
