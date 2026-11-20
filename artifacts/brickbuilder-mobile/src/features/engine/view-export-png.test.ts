// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { BoxGeometry, Group, Mesh, MeshLambertMaterial, PerspectiveCamera } from "three";

const gpu = vi.hoisted(() => ({
  render: vi.fn(), dispose: vi.fn(), forceContextLoss: vi.fn(),
  size: vi.fn(), clear: vi.fn(), pixelRatio: vi.fn(),
  fail: false,
}));
vi.mock("three", async importOriginal => {
  const three = await importOriginal<typeof import("three")>();
  return {
    ...three,
    WebGLRenderer: class {
      capabilities = { maxTextureSize: 8192 };
      domElement = {
        toBlob: (callback: (blob: unknown) => void) => callback({
          arrayBuffer: async () => new Uint8Array([137, 80, 78, 71]).buffer,
        }),
      };
      setPixelRatio = gpu.pixelRatio;
      setSize = gpu.size;
      setClearColor = gpu.clear;
      render = (...args: unknown[]) => {
        gpu.render(...args);
        if (gpu.fail) throw new Error("GPU failure");
      };
      dispose = gpu.dispose;
      forceContextLoss = gpu.forceContextLoss;
    },
  };
});
import { renderView } from "./view-export";

describe("transparent 4K PNG rendering", () => {
  it("renders a separate transparent scene without resizing or altering the source", async () => {
    vi.clearAllMocks();
    const root = new Group();
    const material = new MeshLambertMaterial({ color: "red" });
    const geometry = new BoxGeometry();
    const mesh = new Mesh(geometry, material);
    root.add(mesh);
    const dispose = vi.spyOn(geometry, "dispose");
    const camera = new PerspectiveCamera(42, 9 / 16, 0.1, 4000);
    camera.position.set(4, 5, 10); camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld(true);
    const original = camera.matrixWorld.clone();
    const bytes = await renderView([root], camera, "png");
    expect(Array.from(bytes)).toEqual([137, 80, 78, 71]);
    expect(gpu.size).toHaveBeenCalledWith(2160, 3840, false);
    expect(gpu.pixelRatio).toHaveBeenCalledWith(1);
    expect(gpu.clear).toHaveBeenCalledWith(0, 0);
    const [scene, exportedCamera] = gpu.render.mock.calls[0];
    expect(scene.background).toBeNull();
    expect(scene.children).toHaveLength(2); // lighting and model only
    expect(scene.children[1]).not.toBe(root);
    expect(scene.children[1].children[0].geometry).toBe(geometry);
    expect(root.parent).toBeNull();
    expect(exportedCamera).not.toBe(camera);
    expect(exportedCamera.matrixWorld.equals(original)).toBe(true);
    expect(camera.matrixWorld.equals(original)).toBe(true);
    expect(dispose).not.toHaveBeenCalled();
    expect(gpu.dispose).toHaveBeenCalledOnce();
    expect(gpu.forceContextLoss).toHaveBeenCalledOnce();
  });

  it("also releases the temporary GPU context after rendering fails", async () => {
    vi.clearAllMocks();
    gpu.fail = true;
    try {
      const root = new Group();
      root.add(new Mesh(new BoxGeometry(), new MeshLambertMaterial()));
      await expect(renderView([root], new PerspectiveCamera(), "png")).rejects.toThrow("GPU failure");
      expect(gpu.dispose).toHaveBeenCalledOnce();
      expect(gpu.forceContextLoss).toHaveBeenCalledOnce();
    } finally { gpu.fail = false; }
  });
});
