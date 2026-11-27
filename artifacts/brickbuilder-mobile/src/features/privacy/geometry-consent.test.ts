// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { GEOMETRY_API, remoteGeometryEnabled, requireGeometryPermission, setRemoteGeometryEnabled } from "./geometry-consent";
import { findOnline, hashBytes, OnlineGeometry } from "../formats/online-geometry";
import { acquireThumbnailGeometry } from "../parts/thumbnails/acquire";
const premium = vi.hoisted(() => ({ active: true }));
vi.mock("../premium/store", () => ({ premiumActive: () => premium.active }));

afterEach(() => { premium.active = true; localStorage.clear(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
it("blocks Android downloads without Premium even with existing consent, but leaves the PWA unchanged", () => {
  vi.stubEnv("VITE_NATIVE_ANDROID", "true");
  premium.active = false;
  setRemoteGeometryEnabled(true);
  expect(() => requireGeometryPermission()).toThrow("Premium");
  vi.stubEnv("VITE_NATIVE_ANDROID", "false");
  expect(() => requireGeometryPermission()).not.toThrow();
});
it("uses the canonical first-party geometry API origin", () => {
  expect(GEOMETRY_API).toBe("https://brickbuilder.blackfishbox.de/api");
});
it("defaults to offline and blocks Android requests until explicitly enabled", async () => {
  vi.stubEnv("VITE_NATIVE_ANDROID", "true");
  const network = vi.fn(); vi.stubGlobal("fetch", network);
  expect(remoteGeometryEnabled()).toBe(false);
  await expect(findOnline("consent-required.dat", new OnlineGeometry({}))).rejects.toThrow("deaktiviert");
  await expect(acquireThumbnailGeometry("preview-consent-required", new AbortController().signal)).rejects.toThrow("deaktiviert");
  expect(network).not.toHaveBeenCalled();
  expect(setRemoteGeometryEnabled(true)).toBe(true);
  expect(() => requireGeometryPermission()).not.toThrow();
  expect(setRemoteGeometryEnabled(false)).toBe(true);
  expect(() => requireGeometryPermission()).toThrow("deaktiviert");
});
it("downloads verified geometry from the first-party API after explicit consent", async () => {
  vi.stubEnv("VITE_NATIVE_ANDROID", "true");
  expect(setRemoteGeometryEnabled(true)).toBe(true);
  const legal = `Creative Commons Legal Code\n${"Licensed fixture language for testing only. ".repeat(8)}`;
  const responses = vi.fn(async (input: string | URL | Request) => {
    const url = new URL(String(input));
    expect(url.origin).toBe(new URL(GEOMETRY_API).origin);
    const path = url.searchParams.get("path")!;
    const body = path.endsWith(".dat")
      ? "0 Consent fixture\n0 Author: Test Author\n0 !LICENSE Licensed under CC BY 4.0 : see CAreadme.txt\n3 16 0 0 0 20 0 0 0 20 0\n"
      : legal;
    const bytes = new TextEncoder().encode(body);
    return new Response(bytes as BodyInit, { headers: {
      "X-LDraw-SHA256": await hashBytes(bytes),
      "X-LDraw-Snapshot": "official-live-v1",
    } });
  });
  vi.stubGlobal("fetch", responses);

  const file = await findOnline("consent-download.dat", new OnlineGeometry({}));

  expect(file.path).toBe("parts/consent-download.dat");
  expect(responses).toHaveBeenCalled();
});
it("fails closed if storage cannot be read or written", () => {
  vi.stubEnv("VITE_NATIVE_ANDROID", "true");
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
  expect(remoteGeometryEnabled()).toBe(false);
  expect(setRemoteGeometryEnabled(true)).toBe(false);
  expect(() => requireGeometryPermission()).toThrow("deaktiviert");
});
