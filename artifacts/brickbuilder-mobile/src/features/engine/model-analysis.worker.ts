import { BRICK_HEIGHT, type Brick } from "../editor/model";
import { brickBounds } from "../editor/brick-transform";

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
  const occupied = new Map<string, string>();
  const overlaps = new Set<string>();

  for (const brick of bricks) {
    const bounds = brickBounds(brick);
    const left = bounds.min.x;
    const right = bounds.max.x;
    const front = bounds.min.z;
    const back = bounds.max.z;

    minX = Math.min(minX, left);
    maxX = Math.max(maxX, right);
    minZ = Math.min(minZ, front);
    maxZ = Math.max(maxZ, back);

    const minCellX = Math.round(left * 2);
    const maxCellX = Math.round(right * 2);
    const minCellZ = Math.round(front * 2);
    const maxCellZ = Math.round(back * 2);
    const minLayer = Math.floor(bounds.min.y / BRICK_HEIGHT);
    const maxLayer = Math.floor((bounds.max.y - 1e-9) / BRICK_HEIGHT);
    for (let layer = minLayer; layer <= maxLayer; layer += 1) {
      for (let x = minCellX; x < maxCellX; x += 1) {
        for (let z = minCellZ; z < maxCellZ; z += 1) {
          const key = `${layer}:${x}:${z}`;
          const existing = occupied.get(key);
          if (existing && existing !== brick.id) {
            overlaps.add([existing, brick.id].sort().join(":"));
          } else {
            occupied.set(key, brick.id);
          }
        }
      }
    }
  }

  workerScope.postMessage({
    requestId,
    count: bricks.length,
    bounds: { minX, maxX, minZ, maxZ },
    overlapCount: overlaps.size,
  });
});
