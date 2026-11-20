import { ViewExportError } from "./view-export-job";

/**
 * Export-owned payload ceiling (excluding the already-loaded model / platform share):
 * 600k faces * 17 doubles < 78 MiB; visibility lists/sort scratch < 24 MiB;
 * encoded chunks + final file <= 32 MiB; bounded reuse cache / scratch < 2 MiB.
 * Visibility fragments use this SAME face budget, not a second unbounded store.
 * No DOM tree, expanded Mesh hierarchy, unbounded strings or Array.sort allocations.
 */
export const SVG_LIMITS = {
  faces: 600_000,
  inputTriangles: 5_000_000,
  outputBytes: 16 * 1024 * 1024,
  reuseEntries: 2048,
  visibilityOperations: 24_000_000,
  visibilityDepth: 128,
} as const;

const PAGE = 4096;
const STRIDE = 17; // xy*3, mean z, base RGB, alpha, z*3, irradiance*3, surface ID, emissive RGB

export class SvgFaces {
  private pages: Float64Array[] = [];
  count = 0;

  add(values: readonly number[]) {
    if (this.count >= SVG_LIMITS.faces) throw new ViewExportError("complex");
    const page = Math.floor(this.count / PAGE);
    if (!this.pages[page]) this.pages.push(new Float64Array(PAGE * STRIDE));
    this.pages[page].set(values, (this.count % PAGE) * STRIDE);
    this.count++;
  }

  get(index: number, field: number): number {
    return this.pages[Math.floor(index / PAGE)][(index % PAGE) * STRIDE + field];
  }

  /** Stable painter order, far to near; every merge is interruptible. */
  async sorted(checkpoint: (completed: number, total: number) => Promise<void>): Promise<Uint32Array> {
    let source = new Uint32Array(this.count), target = new Uint32Array(this.count);
    for (let i = 0; i < this.count; i++) {
      source[i] = i;
      if (i % 4096 === 0) await checkpoint(0, this.count);
    }
    const passes = Math.ceil(Math.log2(Math.max(1, this.count)));
    let work = 0;
    const total = Math.max(1, passes * this.count);
    for (let width = 1; width < this.count; width *= 2) {
      for (let start = 0; start < this.count; start += width * 2) {
        const middle = Math.min(start + width, this.count);
        const end = Math.min(start + width * 2, this.count);
        let left = start, right = middle;
        for (let out = start; out < end; out++) {
          target[out] = right >= end || (left < middle &&
            this.get(source[left], 6) >= this.get(source[right], 6))
            ? source[left++] : source[right++];
          if (++work % 4096 === 0) await checkpoint(work, total);
        }
      }
      [source, target] = [target, source];
    }
    return source;
  }
}

/** ASCII-only markup is encoded in small chunks, then copied without a giant join. */
export class SvgBytes {
  private chunks: Uint8Array[] = [];
  private pending = "";
  private size = 0;
  private encoder = new TextEncoder();

  append(text: string) {
    if (this.size + text.length > SVG_LIMITS.outputBytes) throw new ViewExportError("complex");
    this.size += text.length;
    this.pending += text;
    if (this.pending.length >= 32 * 1024) this.flush();
  }

  private flush() {
    if (this.pending) this.chunks.push(this.encoder.encode(this.pending));
    this.pending = "";
  }

  async finish(checkpoint: () => Promise<void>): Promise<Uint8Array> {
    this.flush();
    const bytes = new Uint8Array(this.size);
    let offset = 0;
    for (const chunk of this.chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
      await checkpoint();
    }
    return bytes;
  }
}
