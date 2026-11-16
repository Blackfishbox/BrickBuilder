import { beforeEach, describe, expect, it, vi } from "vitest";
import { Capacitor } from "@capacitor/core";
import { importFileAccept } from "./import-file";

vi.mock("@capacitor/core", () => ({
  Capacitor: { getPlatform: vi.fn(() => "android") },
}));

beforeEach(() => vi.mocked(Capacitor.getPlatform).mockReturnValue("android"));

describe("import document picker filters", () => {
  it.each(["model", "inventory"] as const)(
    "allows every provider MIME type for Android %s imports",
    (kind) => {
      // Includes ZIP, octet-stream, vendor-specific and incorrectly typed files.
      // Actual extension, size and content checks still run after selection.
      expect(importFileAccept(kind)).toBe("*/*");
    },
  );

  it.each(["web", "ios"])("retains the existing filters on %s", (platform) => {
    vi.mocked(Capacitor.getPlatform).mockReturnValue(platform);
    expect(importFileAccept("model")).toBe(".io,.ldr,.mpd,.json");
    expect(importFileAccept("inventory")).toBe(".xml,.csv,text/xml,text/csv");
  });
});
