// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { requestGeometry } from "./geometry-request";

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it("requests the API from the current app origin", async () => {
  const response = new Response("geometry");
  const fetchMock = vi.fn().mockResolvedValue(response);
  vi.stubGlobal("fetch", fetchMock);

  await expect(requestGeometry("18591.dat")).resolves.toBe(response);
  const expected = new URL("/api/ldraw/file?path=18591.dat", window.location.href).href;
  expect(fetchMock).toHaveBeenCalledWith(expected, expect.objectContaining({
    credentials: "omit",
    referrerPolicy: "no-referrer",
  }));
});

it("shows the target and app origin when a browser fetch is blocked", async () => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
  const endpoint = new URL("/api/ldraw/file?path=18591.dat", window.location.href);

  await expect(requestGeometry("18591.dat")).rejects.toThrow(
    `Failed to fetch. API-Ziel: ${endpoint.origin}${endpoint.pathname}; App-Origin: ${window.location.origin}`,
  );
});
