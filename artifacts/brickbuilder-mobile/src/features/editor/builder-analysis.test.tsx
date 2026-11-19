// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { builderDatabase, saveProject } from "@/storage/database";
import { createEmptyDocument, type Brick } from "./model";
import { useBuilder, type ModelAnalysis } from "./useBuilder";

vi.mock("../catalog/client", () => ({
  useCatalog: () => ({ status: "ready" }),
  ensureCatalog: async () => {},
}));

interface AnalysisRequest {
  requestId: number;
  bricks: Brick[];
}
interface AnalysisResponse extends ModelAnalysis {
  requestId: number;
}

let analyze!: (event: MessageEvent<AnalysisRequest>) => void;
let workerOutput!: AnalysisResponse;

beforeAll(async () => {
  // Run the real worker entry point and collision engine; only its transport is
  // controlled so responses can arrive in an intentionally adversarial order.
  vi.stubGlobal("self", {
    addEventListener: (_type: string, listener: typeof analyze) => { analyze = listener; },
    postMessage: (response: AnalysisResponse) => { workerOutput = response; },
  });
  try {
    await import("../engine/model-analysis.worker");
  } finally {
    vi.unstubAllGlobals();
  }
});

class ControlledAnalysisWorker {
  requests: AnalysisRequest[] = [];
  responses: AnalysisResponse[] = [];
  private listener?: (event: MessageEvent<AnalysisResponse>) => void;
  terminate = vi.fn();

  addEventListener(_type: string, listener: NonNullable<ControlledAnalysisWorker["listener"]>) {
    this.listener = listener;
  }

  postMessage(request: AnalysisRequest) {
    const snapshot = structuredClone(request);
    this.requests.push(snapshot);
    analyze({ data: snapshot } as MessageEvent<AnalysisRequest>);
    this.responses.push(structuredClone(workerOutput));
  }

  deliver(response: AnalysisResponse) {
    this.listener!({ data: response } as MessageEvent<AnalysisResponse>);
  }
}

let root: ReturnType<typeof createRoot> | undefined;

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  await builderDatabase.delete();
  vi.unstubAllGlobals();
});

it.each(["x", "z"] as const)(
  "keeps collision analysis current across %s tilt edits, undo, redo and late worker responses",
  async axis => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const worker = new ControlledAnalysisWorker();
    vi.stubGlobal("Worker", class { constructor() { return worker; } });
    await builderDatabase.open();
    const source = createEmptyDocument();
    const bottom: Brick = {
      id: "bottom", type: "brick-2x4", color: "#B40000",
      x: 0, y: 0, z: 0, rotation: 0,
    };
    source.bricks = [bottom, { ...bottom, id: "top", y: 1.2 }];
    await saveProject(source);

    let editor!: ReturnType<typeof useBuilder>;
    function Harness() { editor = useBuilder(); return null; }
    root = createRoot(document.createElement("div"));
    await act(async () => { root!.render(<Harness />); });
    await act(async () => { await vi.waitFor(() => expect(editor.isReady).toBe(true)); });
    await act(async () => editor.select("top"));

    function currentRequest(expectedBricks: Brick[], expectedOverlaps: number) {
      const request = worker.requests.at(-1)!;
      const response = worker.responses.at(-1)!;
      expect(request.bricks).toEqual(expectedBricks);
      expect(response).toMatchObject({
        requestId: request.requestId, count: 2, overlapCount: expectedOverlaps,
      });
      const ids = worker.requests.map(value => value.requestId);
      expect(ids.every((id, i) => i === 0 || id > ids[i - 1])).toBe(true);
      return response;
    }

    async function accept(response: AnalysisResponse) {
      await act(async () => worker.deliver(response));
      const { requestId: _requestId, ...analysis } = response;
      expect(editor.modelAnalysis).toEqual(analysis);
    }

    async function rejectLate(responses: AnalysisResponse[]) {
      const current = editor.modelAnalysis;
      for (const response of responses) {
        await act(async () => worker.deliver(response));
        expect(editor.modelAnalysis).toBe(current);
      }
    }

    const uprightBricks = structuredClone(editor.bricks);
    expect(uprightBricks).toEqual(source.bricks);
    const upright = currentRequest(uprightBricks, 0);
    await accept(upright);
    expect(editor.canUndo).toBe(false);

    let sent = worker.requests.length;
    await act(async () => editor.setSelectedTilt(axis, 45));
    expect(worker.requests).toHaveLength(sent + 1);
    expect(editor.bricks[1]).toMatchObject(axis === "x" ? { tiltX: 45 } : { tiltZ: 45 });
    const tiltedBricks = structuredClone(editor.bricks);
    expect(tiltedBricks[0]).toEqual(uprightBricks[0]);
    const tilted = currentRequest(tiltedBricks, 1);
    await accept(tilted);
    await rejectLate([upright]);

    sent = worker.requests.length;
    await act(async () => editor.undo());
    expect(worker.requests).toHaveLength(sent + 1);
    expect(editor.bricks).toEqual(uprightBricks);
    expect(editor.canRedo).toBe(true);
    const undone = currentRequest(uprightBricks, 0);
    // A stale result must also be rejected while the new response is pending.
    await rejectLate([upright, tilted]);
    await accept(undone);
    await rejectLate([tilted]);

    sent = worker.requests.length;
    await act(async () => editor.redo());
    expect(worker.requests).toHaveLength(sent + 1);
    expect(editor.bricks).toEqual(tiltedBricks);
    expect(editor.canRedo).toBe(false);
    const redone = currentRequest(tiltedBricks, 1);
    await rejectLate([undone]);
    await accept(redone);
    await rejectLate([tilted, upright, undone]);

    // Remove the tilt through the public edit action, then traverse that edit
    // in both directions as well (the clamped height is part of the document).
    sent = worker.requests.length;
    await act(async () => editor.setSelectedTilt(axis, 0));
    expect(worker.requests).toHaveLength(sent + 1);
    expect(editor.bricks[1].tiltX ?? 0).toBe(0);
    expect(editor.bricks[1].tiltZ ?? 0).toBe(0);
    const untiltedBricks = structuredClone(editor.bricks);
    const untilted = currentRequest(untiltedBricks, 0);
    await accept(untilted);
    await rejectLate([redone]);

    sent = worker.requests.length;
    await act(async () => editor.undo());
    expect(worker.requests).toHaveLength(sent + 1);
    expect(editor.bricks).toEqual(tiltedBricks);
    const restoredTilt = currentRequest(tiltedBricks, 1);
    await accept(restoredTilt);
    await rejectLate([untilted, undone]);

    sent = worker.requests.length;
    await act(async () => editor.redo());
    expect(worker.requests).toHaveLength(sent + 1);
    expect(editor.bricks).toEqual(untiltedBricks);
    const removedTilt = currentRequest(untiltedBricks, 0);
    await accept(removedTilt);
    await rejectLate([restoredTilt, redone, tilted, untilted, upright]);
  },
);
