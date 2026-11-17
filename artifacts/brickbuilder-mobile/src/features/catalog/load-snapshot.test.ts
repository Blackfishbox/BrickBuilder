import { afterEach, describe, expect, it, vi } from "vitest";
import { loadSnapshot } from "./load-snapshot";

const good = new Uint8Array([31, 139, 8, 0]);
function setup(cached?: Uint8Array) {
  const options = {
    url: "/api/catalog/snapshot/test/catalog.bin", expectedBytes: good.length,
    read: vi.fn(async () => cached),
    remove: vi.fn(async () => {}),
    save: vi.fn(async (_bytes: Uint8Array) => {}),
    validate: vi.fn(async (bytes: Uint8Array) => {
      if (!bytes.every((b, i) => b === good[i])) throw new Error("Katalog-Prüfsumme stimmt nicht.");
      return { version: "test" };
    }),
  };
  const fetcher = vi.fn(async () => new Response(good));
  vi.stubGlobal("fetch", fetcher);
  return { options, fetcher };
}
afterEach(() => vi.unstubAllGlobals());

describe("catalog transport recovery", () => {
  it("replaces only invalid cached bytes and validates the fresh download in the same call", async () => {
    const { options, fetcher } = setup(new Uint8Array([0]));
    await expect(loadSnapshot(options)).resolves.toEqual({ version: "test" });
    expect(options.remove).toHaveBeenCalledOnce();
    expect(fetcher).toHaveBeenCalledExactlyOnceWith(options.url, expect.objectContaining({ cache: "no-store" }));
    expect(options.save).toHaveBeenCalledWith(good);
  });
  it("also repairs cached bytes of the right length but wrong digest", async () => {
    const { options } = setup(new Uint8Array(good.length));
    await loadSnapshot(options);
    expect(options.remove).toHaveBeenCalledOnce();
    expect(options.validate).toHaveBeenCalledTimes(2);
  });
  it("uses verified cached bytes offline without a request or write", async () => {
    const { options, fetcher } = setup(good);
    await loadSnapshot(options);
    expect(fetcher).not.toHaveBeenCalled();
    expect(options.save).not.toHaveBeenCalled();
    expect(options.remove).not.toHaveBeenCalled();
  });
  it("rejects a wrong-length download before the worker and successfully retries without caching it", async () => {
    const { options, fetcher } = setup();
    fetcher.mockResolvedValueOnce(new Response(new Uint8Array([1])));
    await expect(loadSnapshot(options)).rejects.toThrow("1 statt 4 Bytes");
    expect(options.validate).not.toHaveBeenCalled();
    expect(options.save).not.toHaveBeenCalled();
    await expect(loadSnapshot(options)).resolves.toEqual({ version: "test" });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it.each([
    [new Response("<html>SPA fallback</html>", { headers: { "Content-Type": "text/html" } }), "HTML-Seite"],
    [new Response("<!doctype html><html>fallback</html>"), "HTML-Seite"],
    [new Response('{"schema":1}'), "HTTP-Kompression"],
    [new Response("", { status: 404 }), "Katalogdatei fehlt"],
    [new Response("", { status: 503 }), "HTTP 503"],
  ])("reports an actionable transport failure without saving the response", async (response, message) => {
    const { options, fetcher } = setup();
    fetcher.mockResolvedValueOnce(response);
    await expect(loadSnapshot(options)).rejects.toThrow(message);
    expect(options.save).not.toHaveBeenCalled();
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it("does not persist a right-length download with the wrong digest", async () => {
    const { options, fetcher } = setup();
    fetcher.mockResolvedValueOnce(new Response(new Uint8Array(good.length)));
    await expect(loadSnapshot(options)).rejects.toThrow("Prüfsumme");
    expect(options.save).not.toHaveBeenCalled();
  });
  it("allows retry after a network failure", async () => {
    const { options, fetcher } = setup();
    fetcher.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await expect(loadSnapshot(options)).rejects.toThrow();
    await expect(loadSnapshot(options)).resolves.toEqual({ version: "test" });
  });
});
