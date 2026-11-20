import { afterEach, expect, it, vi } from "vitest";
import { findOnline, OnlineGeometry } from "../features/formats/online-geometry";

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
it("keeps Android geometry downloads offline until the user explicitly enables them", async () => {
  vi.stubEnv("VITE_NATIVE_ANDROID", "true");
  const network = vi.fn();
  vi.stubGlobal("fetch", network);
  await expect(findOnline("unknown-native-part.dat", new OnlineGeometry({}))).rejects.toThrow("deaktiviert");
  expect(network).not.toHaveBeenCalled();
});
