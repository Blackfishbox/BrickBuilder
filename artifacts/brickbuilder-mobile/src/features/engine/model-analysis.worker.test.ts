import { afterEach, expect, it, vi } from "vitest";

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

it("uses tilted 3D bounds when measuring model extent and overlapping layers", async () => {
  const postMessage = vi.fn();
  let onMessage: ((event: MessageEvent) => void) | undefined;
  vi.stubGlobal("self", {
    postMessage,
    addEventListener: (_type: string, listener: (event: MessageEvent) => void) => { onMessage = listener; },
  });
  await import("./model-analysis.worker");
  const brick = { id: "tilted", type: "brick-2x4" as const, color: "#B40000", x: 0, y: 0, z: 0, rotation: 0, tiltX: 45 };
  onMessage!({ data: { requestId: 1, bricks: [
    brick,
    { ...brick, id: "upper", tiltX: 0, y: 1.2 },
  ] } } as MessageEvent);
  const result = postMessage.mock.calls[0][0] as { bounds: { maxZ: number }; overlapCount: number };
  expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({
    requestId: 1,
    count: 2,
    overlapCount: 1,
    bounds: expect.objectContaining({ minZ: -2, maxZ: expect.any(Number) }),
  }));
  expect(result.bounds.maxZ).toBeGreaterThan(2);
});

it("does not report touching upright layers as overlapping", async () => {
  const postMessage = vi.fn();
  let onMessage: ((event: MessageEvent) => void) | undefined;
  vi.stubGlobal("self", {
    postMessage,
    addEventListener: (_type: string, listener: (event: MessageEvent) => void) => { onMessage = listener; },
  });
  await import("./model-analysis.worker");
  const brick = { id: "bottom", type: "brick-2x4" as const, color: "#B40000", x: 0, y: 0, z: 0, rotation: 0 };
  onMessage!({ data: { requestId: 2, bricks: [brick, { ...brick, id: "top", y: 1.2 }] } } as MessageEvent);
  expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({ overlapCount: 0 }));
});
