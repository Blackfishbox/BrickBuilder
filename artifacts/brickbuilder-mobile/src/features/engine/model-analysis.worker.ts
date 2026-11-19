import type { Brick } from "../editor/model";
import { brickVolume, countBrickOverlaps } from "./brick-collision";

interface AnalyzeRequest {
  requestId: number;
  bricks: Brick[];
}

interface AnalyzeResponse {
  requestId: number;
  count: number;
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number } | null;
  overlapCount: number;
}

const workerScope = self as unknown as {
  addEventListener: (
    type: "message",
    listener: (event: MessageEvent<AnalyzeRequest>) => void,
  ) => void;
  postMessage: (message: AnalyzeResponse) => void;
};

workerScope.addEventListener("message", (event) => {
  const { requestId, bricks } = event.data;
  if (!bricks.length) {
    workerScope.postMessage({
      requestId,
      count: 0,
      bounds: null,
      overlapCount: 0,
    });
    return;
  }

  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;
  const volumes = bricks.map(brickVolume);

  for (const { bounds } of volumes) {
    const left = bounds.min.x;
    const right = bounds.max.x;
    const front = bounds.min.z;
    const back = bounds.max.z;

    minX = Math.min(minX, left);
    maxX = Math.max(maxX, right);
    minZ = Math.min(minZ, front);
    maxZ = Math.max(maxZ, back);

  }

  workerScope.postMessage({
    requestId,
    count: bricks.length,
    bounds: { minX, maxX, minZ, maxZ },
    overlapCount: countBrickOverlaps(volumes),
  });
});
