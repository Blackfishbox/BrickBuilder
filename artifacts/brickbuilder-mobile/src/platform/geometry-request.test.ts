// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Capacitor, CapacitorHttp } from "@capacitor/core";
import { GEOMETRY_API, setRemoteGeometryEnabled } from "../features/privacy/geometry-consent";
import { requestGeometry } from "./geometry-request";
import { OnlineGeometry, hashBytes } from "../features/formats/online-geometry";

vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform: vi.fn(() => true) },
  CapacitorHttp: { request: vi.fn() },
}));
beforeEach(() => { vi.stubEnv("VITE_NATIVE_ANDROID", "true"); vi.spyOn(Capacitor, "isNativePlatform").mockReturnValue(true); });
afterEach(() => { localStorage.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
it("makes no native request before opt-in or after withdrawal", async () => {
  const native = vi.spyOn(CapacitorHttp, "request");
  await expect(requestGeometry("parts/3004.dat")).rejects.toThrow("deaktiviert");
  setRemoteGeometryEnabled(true); setRemoteGeometryEnabled(false);
  await expect(requestGeometry("parts/3004.dat")).rejects.toThrow("deaktiviert");
  expect(native).not.toHaveBeenCalled();
});
it("requests only the normalized file path on the fixed HTTPS server", async () => {
  setRemoteGeometryEnabled(true);
  const native = vi.spyOn(CapacitorHttp, "request").mockImplementation(async options => ({
    url: options.url, status: 200, headers: { "X-LDraw-SHA256": "abc" },
    data: btoa("geometry\n"),
  }));
  const response = await requestGeometry("parts/3004.dat");
  expect(await response.text()).toBe("geometry\n");
  expect(response.headers.get("x-ldraw-sha256")).toBe("abc");
  expect(native).toHaveBeenCalledWith(expect.objectContaining({
    url: `${GEOMETRY_API}/ldraw/file?path=parts%2F3004.dat`,
    method: "GET", responseType: "arraybuffer", disableRedirects: true,
    connectTimeout: 15_000, readTimeout: 15_000,
  }));
  expect(native.mock.calls[0][0]).not.toHaveProperty("data");
  await expect(requestGeometry("../secret")).rejects.toThrow();
  expect(native).toHaveBeenCalledOnce();
});
it("rejects redirects, oversized responses and withdrawal during a request", async () => {
  setRemoteGeometryEnabled(true);
  const native = vi.spyOn(CapacitorHttp, "request").mockResolvedValueOnce({
    url: "https://other.invalid/", status: 200, headers: {}, data: btoa("bad"),
  });
  await expect(requestGeometry("parts/3004.dat")).rejects.toThrow("Weiterleitung");
  native.mockImplementationOnce(async options => ({
    url: options.url, status: 200, headers: {}, data: "A".repeat(3_000_000),
  }));
  await expect(requestGeometry("parts/3004.dat")).rejects.toThrow("2 MiB");
  native.mockImplementationOnce(async options => {
    setRemoteGeometryEnabled(false);
    return { url: options.url, status: 200, headers: {}, data: btoa("bad") };
  });
  await expect(requestGeometry("parts/3004.dat")).rejects.toThrow("deaktiviert");
});
it("retains hash validation and does not accept corrupt downloaded geometry", async () => {
  setRemoteGeometryEnabled(true);
  vi.spyOn(CapacitorHttp, "request").mockImplementation(async options => ({
    url: options.url, status: 200,
    headers: { "x-ldraw-sha256": await hashBytes(new TextEncoder().encode("different")),
      "x-ldraw-snapshot": `official-archive-sha256:${"a".repeat(64)}` },
    data: btoa("corrupt geometry"),
  }));
  await expect(new OnlineGeometry({}).get("parts/corrupt-native.dat")).rejects.toThrow("Prüfsumme");
});
it("accepts verified native geometry and license responses including Android base64 line breaks", async () => {
  setRemoteGeometryEnabled(true);
  const content = "0 Synthetic fixture\n0 Author: Test Author\n0 !LICENSE Licensed under CC BY 4.0 : see CAreadme.txt\n3 16 0 0 0 20 0 0 0 20 0\n";
  const legal = "Creative Commons Legal Code\n" + "Synthetic legal fixture. ".repeat(20);
  const native = vi.spyOn(CapacitorHttp, "request").mockImplementation(async options => {
    const path = new URL(options.url).searchParams.get("path")!;
    const text = path.endsWith(".dat") ? content : legal;
    return { url: options.url, status: 200, data: btoa(text).replace(/.{64}/g, "$&\n") + "\n",
      headers: { "x-ldraw-sha256": await hashBytes(new TextEncoder().encode(text)),
        "x-ldraw-snapshot": `official-archive-sha256:${"b".repeat(64)}` } };
  });
  const provider = new OnlineGeometry({});
  const file = await provider.get("parts/valid-native.dat");
  expect(file.content).toBe(content);
  expect(file.retrievalSource).toBe(`official-archive-sha256:${"b".repeat(64)}`);
  expect((await provider.documents()).length).toBeGreaterThan(0);
  const count = native.mock.calls.length;
  await provider.get("parts/valid-native.dat");
  expect(native).toHaveBeenCalledTimes(count);
});
