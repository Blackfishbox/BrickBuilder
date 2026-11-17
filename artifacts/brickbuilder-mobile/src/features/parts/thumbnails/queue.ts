type Listener = { resolve(value: string): void; reject(error: unknown): void };
type Job<T> = { key: string; input: T; controller: AbortController; listeners: Set<Listener> };

/** Serial, cancelable work with a byte- and entry-bounded image LRU. */
export class ThumbnailQueue<T> {
  private cache = new Map<string, string>();
  private bytes = 0;
  private pending = new Map<string, Job<T>>();
  private jobs: Job<T>[] = [];
  private running = false;

  constructor(
    private render: (input: T, signal: AbortSignal) => Promise<string>,
    private maxBytes = 4 * 1024 * 1024,
    private maxEntries = 128,
  ) {}

  get stats() { return { entries: this.cache.size, bytes: this.bytes, pending: this.pending.size }; }

  request(key: string, input: T, signal: AbortSignal): Promise<string> {
    if (signal.aborted) return Promise.reject(signal.reason);
    const cached = this.cache.get(key);
    if (cached) {
      this.cache.delete(key); this.cache.set(key, cached);
      return Promise.resolve(cached);
    }
    let job = this.pending.get(key);
    if (!job) {
      job = { key, input, controller: new AbortController(), listeners: new Set() };
      this.pending.set(key, job);
      this.jobs.push(job);
    }
    const target = job;
    const promise = new Promise<string>((resolve, reject) => {
      const abort = () => {
        target.listeners.delete(listener);
        reject(signal.reason);
        if (!target.listeners.size) {
          target.controller.abort();
          if (this.pending.get(key) === target) this.pending.delete(key);
          this.jobs = this.jobs.filter(queued => queued !== target);
        }
      };
      const listener: Listener = {
        resolve: value => { signal.removeEventListener("abort", abort); resolve(value); },
        reject: error => { signal.removeEventListener("abort", abort); reject(error); },
      };
      target.listeners.add(listener);
      signal.addEventListener("abort", abort, { once: true });
    });
    void this.pump();
    return promise;
  }

  private async pump() {
    if (this.running) return;
    this.running = true;
    try {
      while (this.jobs.length) {
        const job = this.jobs.shift()!;
        try {
          job.controller.signal.throwIfAborted();
          const image = await this.render(job.input, job.controller.signal);
          job.controller.signal.throwIfAborted();
          const cost = image.length * 2;
          if (cost <= this.maxBytes) {
            this.cache.set(job.key, image); this.bytes += cost;
            while (this.bytes > this.maxBytes || this.cache.size > this.maxEntries) {
              const oldest = this.cache.keys().next().value!;
              this.bytes -= this.cache.get(oldest)!.length * 2;
              this.cache.delete(oldest);
            }
          }
          for (const listener of job.listeners) listener.resolve(image);
        } catch (error) {
          for (const listener of job.listeners) listener.reject(error);
        } finally {
          job.listeners.clear();
          if (this.pending.get(job.key) === job) this.pending.delete(job.key);
        }
        // Give touch, scrolling and the editor's own renderer a turn.
        if (this.jobs.length) await new Promise(resolve => setTimeout(resolve, 12));
      }
    } finally { this.running = false; }
  }
}
