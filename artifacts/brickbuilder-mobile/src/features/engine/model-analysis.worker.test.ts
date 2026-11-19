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

it("uses narrow-phase intersections and counts every pair in the worker response", async () => {
  const postMessage = vi.fn();
  let onMessage: ((event: MessageEvent) => void) | undefined;
  vi.stubGlobal("self", {
    postMessage,
    addEventListener: (_type: string, listener: (event: MessageEvent) => void) => { onMessage = listener; },
  });
  await import("./model-analysis.worker");
  const brick = { id: "a", type: "brick-1x2" as const, color: "#B40000", x: 0, y: 0, z: 0, rotation: 0 };
  const distance = 1.74 / Math.sqrt(2);
  const tiltedCenter = 0.6 / Math.sqrt(2);
  onMessage!({ data: { requestId: 3, bricks: [
    { ...brick, tiltX: 45 },
    { ...brick, id: "b", y: tiltedCenter + distance - 0.6, z: tiltedCenter + distance },
  ] } } as MessageEvent);
  expect(postMessage).toHaveBeenLastCalledWith(expect.objectContaining({ requestId: 3, overlapCount: 0 }));
  onMessage!({ data: { requestId: 4, bricks: [
    brick, { ...brick, id: "b" }, { ...brick, id: "c" },
  ] } } as MessageEvent);
  expect(postMessage).toHaveBeenLastCalledWith(expect.objectContaining({ requestId: 4, overlapCount: 3 }));
  onMessage!({ data: { requestId: 5, bricks: [] } } as MessageEvent);
  expect(postMessage).toHaveBeenLastCalledWith({
    requestId: 5, count: 0, bounds: null, overlapCount: 0,
  });
});
