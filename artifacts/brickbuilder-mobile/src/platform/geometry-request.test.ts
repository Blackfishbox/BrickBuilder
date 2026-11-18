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
    mode: "same-origin",
    credentials: "omit",
    referrerPolicy: "no-referrer",
  }));
});

it("retries through XHR and preserves API integrity headers when fetch is blocked", async () => {
  const fetchMock = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
  vi.stubGlobal("fetch", fetchMock);
  class MockXhr {
    static instance: MockXhr;
    response = new TextEncoder().encode("geometry").buffer;
    status = 200;
    statusText = "OK";
    responseType = "";
    timeout = 0;
    withCredentials = false;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    ontimeout: (() => void) | null = null;
    onabort: (() => void) | null = null;
    open = vi.fn();
    send = vi.fn(() => queueMicrotask(() => this.onload?.()));
    getAllResponseHeaders = vi.fn(() => "X-LDraw-SHA256: abc\r\nX-LDraw-Snapshot: official-live-v1\r\n");
    constructor() { MockXhr.instance = this; }
  }
  vi.stubGlobal("XMLHttpRequest", MockXhr as unknown as typeof XMLHttpRequest);
  const expected = new URL("/api/ldraw/file?path=18591.dat", window.location.href).href;

  const response = await requestGeometry("18591.dat");

  expect(response.status).toBe(200);
  expect(response.headers.get("x-ldraw-sha256")).toBe("abc");
  expect(await response.text()).toBe("geometry");
  expect(fetchMock).toHaveBeenCalledOnce();
  expect(MockXhr.instance.open).toHaveBeenCalledWith("GET", expected, true);
  expect(MockXhr.instance.responseType).toBe("arraybuffer");
  expect(MockXhr.instance.withCredentials).toBe(false);
});

it("reports both transports and request context when browser access is blocked", async () => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
  class FailedXhr {
    static instance: FailedXhr;
    status = 0;
    statusText = "";
    responseType = "";
    timeout = 0;
    withCredentials = false;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    ontimeout: (() => void) | null = null;
    onabort: (() => void) | null = null;
    open = vi.fn();
    send = vi.fn(() => queueMicrotask(() => this.onerror?.()));
    getAllResponseHeaders = vi.fn(() => "");
    constructor() { FailedXhr.instance = this; }
  }
  vi.stubGlobal("XMLHttpRequest", FailedXhr as unknown as typeof XMLHttpRequest);
  const endpoint = new URL("/api/ldraw/file?path=18591.dat", window.location.href);
  const frame = window.top === window.self ? "top-level" : "embedded";
  const serviceWorker = navigator.serviceWorker?.controller?.scriptURL ?? "none";

  await expect(requestGeometry("18591.dat")).rejects.toThrow(
    `Failed to fetch; XHR: XHR-Netzwerkfehler. API-Ziel: ${endpoint.origin}${endpoint.pathname}${endpoint.search}; App-Origin: ${window.location.origin}; Frame: ${frame}; Service Worker: ${serviceWorker}`,
  );
});
