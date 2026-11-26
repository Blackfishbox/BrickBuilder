import { expect, it, vi } from "vitest";
import { BufferAttribute, BufferGeometry, Group, InstancedMesh, MeshBasicMaterial, type WebGLRenderer } from "three";
import { releaseBetweenInstructionImages, RELEASE_IMAGE_BUFFERS_ABOVE } from "./image-resources";
import type { InstructionImageRenderer } from "./render";

function fixture(large = true) {
  const geometry = new BufferGeometry().setAttribute("position",
    new BufferAttribute(new Float32Array(large ? RELEASE_IMAGE_BUFFERS_ABOVE / 4 : 9), 3));
  const mesh = new InstancedMesh(geometry, new MeshBasicMaterial(), 1);
  const root = new Group(); root.add(mesh);
  const releaseGeometry = vi.spyOn(geometry, "dispose");
  const releaseInstances = vi.spyOn(mesh, "dispose");
  const images: InstructionImageRenderer = {
    image: vi.fn(() => "data:image/png;base64,rendered"), dispose: vi.fn(),
  };
  const renderer = { renderLists: { dispose: vi.fn() }, setSize: vi.fn() };
  const output = { width: 2000, height: 1520 };
  const wrapped = releaseBetweenInstructionImages(images, root, renderer as unknown as WebGLRenderer,
    output as HTMLCanvasElement);
  return { wrapped, images, root, mesh, renderer, output, releaseGeometry, releaseInstances };
}

it("releases large image GPU buffers after every PNG, retaining complete reusable CPU geometry", () => {
  const f = fixture();
  const originalPositions = f.mesh.geometry.getAttribute("position");
  const visible = new Set(["part"]);
  const step = { id: "s", title: "", notes: "", partIds: [...visible] };
  for (let image = 0; image < 3; image++) {
    expect(f.wrapped.image(visible, step)).toBe("data:image/png;base64,rendered");
    expect(f.releaseGeometry).toHaveBeenCalledTimes(image + 1);
    expect(f.releaseInstances).toHaveBeenCalledTimes(image + 1);
    expect(f.root.children).toEqual([f.mesh]);
    expect(f.mesh.geometry.getAttribute("position")).toBe(originalPositions);
    expect(f.renderer.setSize).toHaveBeenLastCalledWith(1, 1);
    expect(f.output).toEqual({ width: 1, height: 1 });
  }
  expect(f.images.dispose).not.toHaveBeenCalled();
  f.wrapped.dispose(); f.wrapped.dispose();
  expect(f.images.dispose).toHaveBeenCalledOnce();
});

it("releases GPU uploads after an image failure without masking it", () => {
  const f = fixture();
  vi.mocked(f.images.image).mockImplementationOnce(() => { throw new Error("context lost"); });
  expect(() => f.wrapped.image(new Set(), { id: "s", title: "", notes: "", partIds: [] })).toThrow("context lost");
  expect(f.releaseGeometry).toHaveBeenCalledOnce();
  expect(f.renderer.renderLists.dispose).toHaveBeenCalledOnce();
});

it("keeps the existing reusable renderer fast for small models", () => {
  const f = fixture(false);
  expect(f.wrapped).toBe(f.images);
  f.wrapped.image(new Set(), { id: "s", title: "", notes: "", partIds: [] });
  expect(f.releaseGeometry).not.toHaveBeenCalled();
});
