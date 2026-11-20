export type ViewExportProgress = {
  phase: "project" | "sort" | "visibility" | "write";
  completed: number;
  total?: number;
};

export interface ViewExportOptions {
  signal?: AbortSignal;
  onProgress?: (progress: ViewExportProgress) => void;
}

export class ViewExportError extends Error {
  constructor(public readonly reason: "unavailable" | "empty" | "complex" | "gpu" | "cancelled") {
    super(reason);
  }
}

/** A real task boundary, not a microtask: Android can paint and handle cancellation. */
export function exportJob(options: ViewExportOptions) {
  let deadline = 0;
  let reportedAt = -Infinity;
  let reportedPhase = "";
  return async (progress: ViewExportProgress, force = false) => {
    if (options.signal?.aborted) throw new ViewExportError("cancelled");
    if (!force && reportedPhase === progress.phase && performance.now() < deadline) return;
    if (force || reportedPhase !== progress.phase || performance.now() - reportedAt >= 75) {
      options.onProgress?.(progress);
      reportedPhase = progress.phase;
      reportedAt = performance.now();
    }
    await new Promise<void>(resolve => setTimeout(resolve, 0));
    if (options.signal?.aborted) throw new ViewExportError("cancelled");
    deadline = performance.now() + 5;
  };
}
