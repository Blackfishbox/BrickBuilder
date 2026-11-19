// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { Box3, PerspectiveCamera, Vector3 } from "three";
import { ConnectionOverlay, MARKER_LIMIT } from "./overlay";
import type { Contact } from "./types";

afterEach(() => vi.restoreAllMocks());
it("bounds marker work and does not take pointer gestures in either renderer", () => {
  const context = { clearRect: vi.fn(), beginPath: vi.fn(), arc: vi.fn(), fill: vi.fn(), stroke: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(),
    save: vi.fn(), restore: vi.fn(), setLineDash: vi.fn(), strokeRect: vi.fn() };
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(context as unknown as CanvasRenderingContext2D);
  const host = document.createElement("div"), overlay = new ConnectionOverlay(host), camera = new PerspectiveCamera(42, 1, 0.1, 100);
  camera.position.set(0, 0, 10); camera.lookAt(0, 0, 0);
  overlay.contacts = Array.from({ length: 500 }, (_, i) => ({
    id: String(i), movingId: "a", targetId: "b", movingConnectorId: "a", targetConnectorId: "b",
    family: "cylinder", position: [0, 0, 0], state: "verified",
    orientation: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0], evidence: [],
  } satisfies Contact));
  overlay.previews = Array.from({ length: 500 }, (_, i) => ({ ...overlay.contacts[0], id: `suggestion-${i}` }));
  overlay.draw(camera, 0, () => null);
  expect(context.arc).toHaveBeenCalledTimes(MARKER_LIMIT * 2);
  expect(context.setLineDash).toHaveBeenCalledWith([2, 2]);
  expect(overlay.canvas.dataset.testid).toBe("connection-overlay");
  expect(overlay.canvas.style.pointerEvents).toBe("none");
  overlay.visible = false; overlay.draw(camera, 0, () => null);
  expect(context.arc).toHaveBeenCalledTimes(MARKER_LIMIT * 2);
  overlay.dispose();
  expect(host.children).toHaveLength(0); expect(overlay.contacts).toHaveLength(0);
});

it("fans out overlapping suggestions and keeps them distinct from snapped and verified contacts", () => {
  const context = {
    clearRect: vi.fn(), beginPath: vi.fn(), arc: vi.fn(), fill: vi.fn(), stroke: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(),
    save: vi.fn(), restore: vi.fn(), setLineDash: vi.fn(), strokeRect: vi.fn(),
  };
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(context as unknown as CanvasRenderingContext2D);
  const host = document.createElement("div"), overlay = new ConnectionOverlay(host);
  vi.spyOn(overlay.canvas, "getBoundingClientRect").mockReturnValue({ width: 400, height: 400 } as DOMRect);
  const camera = new PerspectiveCamera(42, 1, 0.1, 100);
  camera.position.set(0, 0, 10); camera.lookAt(0, 0, 0);
  const contact = (id: string, state: Contact["state"]): Contact => ({
    id, movingId: "moving", targetId: "target", movingConnectorId: `moving-${id}`, targetConnectorId: `target-${id}`,
    family: "cylinder", position: [0, 0, 0], state,
    orientation: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0], evidence: [],
  });
  overlay.contacts = [contact("snapped", "candidate"), contact("confirmed", "verified")];
  overlay.previews = [contact("nearby-1", "candidate"), contact("nearby-2", "candidate"), contact("nearby-3", "candidate")];
  overlay.draw(camera, 0, () => null);

  const markers = context.arc.mock.calls.map(([x, y, radius]) => ({ x, y, radius }));
  const suggestions = markers.filter(marker => marker.radius === 7);
  const committed = markers.filter(marker => marker.radius === 5);
  expect(suggestions).toHaveLength(3);
  expect(committed).toHaveLength(2);
  expect(context.setLineDash).toHaveBeenCalledWith([2, 2]);
  expect(context.lineTo.mock.calls.length).toBeGreaterThanOrEqual(3);
  for (let i = 0; i < suggestions.length; i++) {
    for (let j = i + 1; j < suggestions.length; j++) {
      expect(Math.hypot(suggestions[i].x - suggestions[j].x, suggestions[i].y - suggestions[j].y)).toBeGreaterThanOrEqual(16);
    }
    for (const contactMarker of committed) {
      expect(Math.hypot(suggestions[i].x - contactMarker.x, suggestions[i].y - contactMarker.y)).toBeGreaterThanOrEqual(16);
    }
  }
  overlay.dispose();
});

it("marks floating parts even with connection markers disabled and clears them after support returns", () => {
  const context = { clearRect: vi.fn(), strokeRect: vi.fn(), fillRect: vi.fn(), fillText: vi.fn() };
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(context as unknown as CanvasRenderingContext2D);
  const host = document.createElement("div"), overlay = new ConnectionOverlay(host);
  vi.spyOn(overlay.canvas, "getBoundingClientRect").mockReturnValue({ width: 400, height: 600 } as DOMRect);
  const camera = new PerspectiveCamera(42, 400 / 600, 0.1, 100);
  camera.position.set(0, 0, 10); camera.lookAt(0, 0, 0);
  overlay.visible = false;
  overlay.floating.set("air", new Box3(new Vector3(-1, -1, -1), new Vector3(1, 1, 1)));
  overlay.draw(camera, 0, () => null);
  expect(context.strokeRect).toHaveBeenCalledTimes(1);
  expect(context.fillText).toHaveBeenCalledWith("!", expect.any(Number), expect.any(Number));
  expect(context.strokeStyle).toBe("#c52236");
  overlay.floating.clear();
  overlay.draw(camera, 0, () => null);
  expect(context.clearRect).toHaveBeenCalledTimes(2);
  expect(context.strokeRect).toHaveBeenCalledTimes(1);
  overlay.dispose();
});
