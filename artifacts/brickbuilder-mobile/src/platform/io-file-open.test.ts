import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { XMLParser } from "fast-xml-parser";

const mock = vi.hoisted(() => ({
  platform: "android",
  payload: null as null | { name: string; base64: string },
  listener: undefined as undefined | (() => void),
  readPendingFile: vi.fn(async () => mock.payload),
  remove: vi.fn(async () => {}),
}));

vi.mock("@capacitor/core", () => ({
  Capacitor: { getPlatform: () => mock.platform },
  registerPlugin: () => ({
    readPendingFile: mock.readPendingFile,
    addListener: async (_event: string, listener: () => void) => {
      mock.listener = listener;
      return { remove: mock.remove };
    },
  }),
}));

import { fileFromNativeIO, watchForOpenedIOFiles } from "./io-file-open";

beforeEach(() => {
  mock.platform = "android";
  mock.payload = null;
  mock.listener = undefined;
  vi.clearAllMocks();
});

describe("Android .io file association", () => {
  it("preserves binary file bytes when converting a native file handoff", async () => {
    const file = fileFromNativeIO({ name: "model.io", base64: btoa(String.fromCharCode(0, 255, 65)) });
    expect(file.name).toBe("model.io");
    expect([...new Uint8Array(await file.arrayBuffer())]).toEqual([0, 255, 65]);
    expect(() => fileFromNativeIO({ name: "model.pdf", base64: "" })).toThrow("Unsupported file type");
  });

  it("opens cold-start files and handles files opened while the app is running", async () => {
    const opened: File[] = [];
    const onError = vi.fn();
    mock.payload = { name: "cold.io", base64: btoa("cold") };
    const listenerHandle = await watchForOpenedIOFiles(file => opened.push(file), onError);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(opened.map(file => file.name)).toEqual(["cold.io"]);

    mock.payload = { name: "warm.io", base64: btoa("warm") };
    mock.listener?.();
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(opened.map(file => file.name)).toEqual(["cold.io", "warm.io"]);
    expect(onError).not.toHaveBeenCalled();
    await listenerHandle?.remove();
  });

  it("does not register a native listener in the PWA", async () => {
    mock.platform = "web";
    expect(await watchForOpenedIOFiles(vi.fn(), vi.fn())).toBeNull();
    expect(mock.readPendingFile).not.toHaveBeenCalled();
  });

  it("declares Android file-open filters and registers the native reader plugin", () => {
    const manifestText = readFileSync(new URL("../../android/app/src/main/AndroidManifest.xml", import.meta.url), "utf8");
    const manifest = new XMLParser({ ignoreAttributes: false }).parse(manifestText).manifest;
    const filters = manifest.application.activity["intent-filter"];
    const viewFilters = filters.filter((filter: Record<string, unknown>) =>
      filter.action?.["@_android:name"] === "android.intent.action.VIEW");
    expect(viewFilters).toHaveLength(3);
    expect(viewFilters.map((filter: Record<string, any>) =>
      filter.data.find((entry: Record<string, string>) => entry["@_android:mimeType"])["@_android:mimeType"])).toEqual([
      "application/zip", "application/x-zip-compressed", "application/octet-stream",
    ]);
    expect(viewFilters.every((filter: Record<string, any>) =>
      filter.data.some((entry: Record<string, string>) => entry["@_android:scheme"] === "file"))).toBe(true);
    const activity = readFileSync(new URL("../../android/app/src/main/java/brickbuilder/blackfishbox/de/MainActivity.java", import.meta.url), "utf8");
    expect(activity).toContain("registerPlugin(IOFileOpenPlugin.class)");
    const plugin = readFileSync(new URL("../../android/app/src/main/java/brickbuilder/blackfishbox/de/IOFileOpenPlugin.java", import.meta.url), "utf8");
    expect(plugin).toContain('notifyListeners("fileOpened"');
    expect(plugin).toContain("MAX_FILE_BYTES = 32 * 1024 * 1024");
  });
});
