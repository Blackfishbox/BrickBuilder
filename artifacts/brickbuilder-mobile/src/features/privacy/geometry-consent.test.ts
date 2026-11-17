// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { remoteGeometryEnabled, requireGeometryPermission, setRemoteGeometryEnabled } from "./geometry-consent";
import { findOnline, OnlineGeometry } from "../formats/online-geometry";
import { acquireThumbnailGeometry } from "../parts/thumbnails/acquire";

afterEach(() => { localStorage.clear(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
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
it("fails closed if storage cannot be read or written", () => {
  vi.stubEnv("VITE_NATIVE_ANDROID", "true");
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
  expect(remoteGeometryEnabled()).toBe(false);
  expect(setRemoteGeometryEnabled(true)).toBe(false);
  expect(() => requireGeometryPermission()).toThrow("deaktiviert");
});
