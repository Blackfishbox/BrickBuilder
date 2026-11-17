import { describe, expect, it, vi } from "vitest";
import { ThumbnailQueue } from "./queue";

const deferred = () => {
  let resolve!: (value: string) => void;
  const promise = new Promise<string>(done => { resolve = done; });
  return { promise, resolve };
};

describe("bounded thumbnail scheduling", () => {
  it("deduplicates identical work and never runs two renderers concurrently", async () => {
    const first = deferred();
    const render = vi.fn(async (value: string) => value === "first" ? first.promise : value);
    const queue = new ThumbnailQueue(render);
    const signal = new AbortController().signal;
    const a = queue.request("a", "first", signal);
    const duplicate = queue.request("a", "first", signal);
    const b = queue.request("b", "second", signal);
    expect(render).toHaveBeenCalledTimes(1);
    first.resolve("image-a");
    expect(await a).toBe("image-a");
    expect(await duplicate).toBe("image-a");
    expect(await b).toBe("second");
    expect(render).toHaveBeenCalledTimes(2);
    expect(await queue.request("a", "unused", signal)).toBe("image-a");
    expect(render).toHaveBeenCalledTimes(2);
  });

  it("cancels invisible queued rows without discarding another subscriber", async () => {
    const first = deferred();
    const render = vi.fn(() => first.promise);
    const queue = new ThumbnailQueue(render);
    const a = new AbortController(), b = new AbortController(), hidden = new AbortController();
    const one = queue.request("shared", "first", a.signal);
    const two = queue.request("shared", "first", b.signal);
    const invisible = queue.request("hidden", "not-rendered", hidden.signal);
    const rejected = expect(one).rejects.toMatchObject({ name: "AbortError" });
    const hiddenRejected = expect(invisible).rejects.toMatchObject({ name: "AbortError" });
    a.abort(); hidden.abort();
    first.resolve("image");
    await rejected; await hiddenRejected;
    expect(await two).toBe("image");
    expect(render).toHaveBeenCalledTimes(1);
    expect(queue.stats.pending).toBe(0);
  });

  it("evicts by bytes and LRU entries, and does not cache failures", async () => {
    const render = vi.fn(async (value: string) => {
      if (value === "fail") throw new Error("Geometry missing");
      return value;
    });
    const queue = new ThumbnailQueue(render, 16, 2);
    const signal = new AbortController().signal;
    await queue.request("a", "aaaa", signal);
    await queue.request("b", "bbbb", signal);
    await queue.request("a", "unused", signal);
    await queue.request("c", "cccc", signal);
    expect(queue.stats).toMatchObject({ entries: 2, bytes: 16 });
    await queue.request("b", "new", signal);
    expect(render).toHaveBeenLastCalledWith("new", expect.any(AbortSignal));
    await expect(queue.request("bad", "fail", signal)).rejects.toThrow("Geometry missing");
    await expect(queue.request("bad", "fail", signal)).rejects.toThrow("Geometry missing");
    expect(queue.stats.bytes).toBeLessThanOrEqual(16);
  });

  it("rejects stale active work and allows the same key to be requested again", async () => {
    const stale = deferred();
    const render = vi.fn().mockImplementationOnce(() => stale.promise).mockResolvedValue("fresh");
    const queue = new ThumbnailQueue(render);
    const old = new AbortController();
    const previous = queue.request("key", "old", old.signal);
    const rejection = expect(previous).rejects.toMatchObject({ name: "AbortError" });
    old.abort();
    const next = queue.request("key", "new", new AbortController().signal);
    stale.resolve("must-not-be-cached");
    await rejection;
    expect(await next).toBe("fresh");
    expect(queue.stats.pending).toBe(0);
  });
});
