import { collisionWarnings } from "./collision-warning";
import type { Brick } from "../editor/model";
import type { ImportedModel } from "../formats/types";

interface CollisionWorkerRequest {
  bricks: Brick[];
  model?: ImportedModel;
  importedOffset?: number;
}

interface SerializedCollisionResult {
  boxes: [string, [number, number, number], [number, number, number]][];
  uncertain: boolean;
}

const workerScope = self as unknown as {
  onmessage: ((event: MessageEvent<CollisionWorkerRequest>) => void) | null;
  postMessage: (message: SerializedCollisionResult | { error: { name: string; message: string } }) => void;
};

workerScope.onmessage = async event => {
  try {
    const result = await collisionWarnings(event.data.bricks, event.data.model, new AbortController().signal, event.data.importedOffset);
    workerScope.postMessage({
      boxes: [...result.boxes].map(([id, box]) => [id, box.min.toArray(), box.max.toArray()]),
      uncertain: result.uncertain,
    });
  } catch (error) {
    workerScope.postMessage({
      error: {
        name: error instanceof Error ? error.name : "Error",
        message: error instanceof Error ? error.message : String(error),
      },
    });
  }
};
