import { afterEach, expect, it, vi } from "vitest";
import { InstancedMesh, type Camera, type Scene } from "three";
import { createEmptyDocument } from "../editor/model";
import { parseLDraw } from "../formats/ldraw/parser";
import { createInstructionRenderer } from "./render";

const { frames } = vi.hoisted(() => ({ frames: vi.fn() }));
vi.mock("three", async importOriginal => {
  const three = await importOriginal<typeof import("three")>();
  return { ...three, WebGLRenderer: class {
    domElement = { toDataURL: () => "data:image/jpeg;base64,webgl" };
    setPixelRatio() {} setSize() {} setClearColor() {} dispose() {} forceContextLoss() {}
    render(scene: Scene, camera: Camera) {
      scene.updateMatrixWorld(true); camera.updateMatrixWorld(true); frames(scene);
    }
  } };
});
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

it("unions imported material batches before outlining groups in the WebGL PDF path", async () => {
  const document = createEmptyDocument();
  const sourceText = [0, 40, 80, 120, 240].map(x => `1 4 ${x} 0 0 1 0 0 0 1 0 0 0 1 test.dat`).join("\n");
  document.imported = { version: 1, format: "mpd", sourceName: "test.mpd", sourceText, originalBytes: [],
    ...parseLDraw(sourceText), resources: {
      "parts/test.dat": { path: "parts/test.dat", source: "embedded",
        content: "0 Test\n4 16 -20 0 -20 20 0 -20 20 -24 -20 -20 -24 -20\n4 14 -20 0 20 20 0 20 20 -24 20 -20 -24 20" },
    }, legalDocuments: [] };
  document.imported.instances.forEach(part => { part.part.status = "resolved"; });
  document.bricks = [0, 2, 4, 6].map((x, i) =>
    ({ id: `local-${i}`, type: "brick-2x2", color: "#ff0000", x, y: 0, z: 8, rotation: 0 }));
  const context = { drawImage: vi.fn(), save: vi.fn(), restore: vi.fn(), beginPath: vi.fn(),
    moveTo: vi.fn(), lineTo: vi.fn(), stroke: vi.fn(), strokeStyle: "", lineWidth: 0, globalAlpha: 1 };
  vi.stubGlobal("document", { createElement: () => ({
    width: 0, height: 0, getContext: () => context, toDataURL: () => "data:image/jpeg;base64,outlined",
  }) });
  const ids = [...document.imported.instances.map(part => part.id), ...document.bricks.map(part => part.id)];
  const before = JSON.stringify(document);
  const renderer = await createInstructionRenderer(document);
  try {
    for (const rotation of [[0, 0, 0], [20, 65, -15]] as [number, number, number][]) {
      context.stroke.mockClear(); context.lineTo.mockClear();
      renderer.image(new Set(ids), { id: "s", title: "", notes: "", partIds: ids, rotation }, new Set(ids));
      expect(context.stroke).toHaveBeenCalledTimes(3); // Two imported clusters + one local cluster.
      expect(context.lineTo).toHaveBeenCalledTimes(36);
    }
    let batches = 0;
    (frames.mock.lastCall![0] as Scene).traverse(object => {
      if (object instanceof InstancedMesh) batches++;
    });
    expect(batches).toBe(2);
    context.stroke.mockClear();
    renderer.image(new Set(ids), { id: "s", title: "", notes: "", partIds: ids });
    expect(context.stroke).not.toHaveBeenCalled();
    renderer.image(new Set([ids[0]]), { id: "s", title: "", notes: "", partIds: ids }, new Set(ids));
    expect(context.stroke).toHaveBeenCalledOnce();
    expect(JSON.stringify(document)).toBe(before);
  } finally { renderer.dispose(); }
});
