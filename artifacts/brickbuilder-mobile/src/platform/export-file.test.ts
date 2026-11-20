// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { Capacitor } from "@capacitor/core";
import { Filesystem } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";
import { exportFile } from "./export-file";
import { renderSvgView } from "../features/engine/svg-view-export";
import { largeSvgModel } from "../../test-fixtures/large-svg-model";

vi.mock("@capacitor/filesystem", () => ({
  Directory: { Cache: "CACHE" },
  Filesystem: { writeFile: vi.fn(), appendFile: vi.fn(), getUri: vi.fn().mockResolvedValue({ uri: "file:///cache/project.json" }) },
}));
vi.mock("@capacitor/share", () => ({ Share: { share: vi.fn().mockResolvedValue({}) } }));
afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  vi.mocked(Filesystem.writeFile).mockReset();
  vi.mocked(Filesystem.appendFile).mockReset();
});
describe("local Android exports", () => {
  it("reopens exact multi-megabyte SVG bytes after a paused native append", async () => {
    vi.spyOn(Capacitor, "isNativePlatform").mockReturnValue(true);
    const fixture = largeSvgModel();
    try {
      const bytes = await renderSvgView([fixture.model], fixture.camera, 2160, 3840);
      expect(bytes.length).toBeGreaterThan(2 * 1024 * 1024);
      const chunks: Uint8Array[] = [];
      const decode = (data: string) => Uint8Array.from(atob(data), ch => ch.charCodeAt(0));
      let resume!: () => void;
      let appended!: () => void;
      const paused = new Promise<void>(resolve => { appended = resolve; });
      const pending = new Promise<void>(resolve => { resume = resolve; });
      vi.mocked(Filesystem.writeFile).mockImplementationOnce(async options => {
        chunks.push(decode(options.data as string));
        return { uri: "file:///cache/reference.svg" };
      });
      vi.mocked(Filesystem.appendFile).mockImplementation(async options => {
        // Simulate a delayed bridge result, NOT an actual Android lifecycle event.
        if (chunks.length === 1) { appended(); await pending; }
        chunks.push(decode(options.data));
      });
      const sharing = exportFile(bytes, "reference.svg", "image/svg+xml");
      await paused;
      expect(Filesystem.getUri).not.toHaveBeenCalled();
      expect(Share.share).not.toHaveBeenCalled();
      resume();
      await sharing;
      const reopened = new Uint8Array(chunks.reduce((size, chunk) => size + chunk.length, 0));
      let offset = 0;
      for (const chunk of chunks) { reopened.set(chunk, offset); offset += chunk.length; }
      expect(reopened).toEqual(bytes);
      const svg = new TextDecoder().decode(reopened);
      expect(svg).toContain("background-color:transparent");
      expect(svg.endsWith("</svg>")).toBe(true);
      const xml = new DOMParser().parseFromString(svg, "image/svg+xml");
      expect(xml.querySelector("parsererror")).toBeNull();
      expect(xml.documentElement.localName).toBe("svg");
      expect(xml.querySelector("image, rect, foreignObject")).toBeNull();
      expect(Filesystem.getUri).toHaveBeenCalledOnce();
      expect(Share.share).toHaveBeenCalledOnce();
    } finally { fixture.dispose(); }
  }, 30_000);

  it("rejects a failed later append without sharing and uses a fresh path on retry", async () => {
    vi.spyOn(Capacitor, "isNativePlatform").mockReturnValue(true);
    vi.mocked(Filesystem.appendFile)
      .mockResolvedValueOnce()
      .mockRejectedValueOnce(new Error("Cache full"));
    const bytes = new Uint8Array(800_001);
    await expect(exportFile(bytes, "model.svg", "image/svg+xml")).rejects.toThrow("Cache full");
    expect(Filesystem.getUri).not.toHaveBeenCalled();
    expect(Share.share).not.toHaveBeenCalled();
    const failedPath = vi.mocked(Filesystem.writeFile).mock.calls[0][0].path;
    await exportFile(bytes, "model.svg", "image/svg+xml");
    expect(vi.mocked(Filesystem.writeFile).mock.calls[1][0].path).not.toBe(failedPath);
    expect(Share.share).toHaveBeenCalledOnce();
  });

  it("writes exact chunked bytes and shares a local file without an external upload", async () => {
    vi.spyOn(Capacitor, "isNativePlatform").mockReturnValue(true);
    const bytes = Uint8Array.from({ length: 600_001 }, (_, i) => i % 256);
    await exportFile(bytes, "model.io", "application/octet-stream");
    expect(Filesystem.writeFile).toHaveBeenCalledOnce();
    expect(Filesystem.appendFile).toHaveBeenCalledTimes(3);
    const calls = [vi.mocked(Filesystem.writeFile).mock.calls[0][0], ...vi.mocked(Filesystem.appendFile).mock.calls.map(c => c[0])];
    const decoded = calls.flatMap(c => [...Uint8Array.from(atob(c.data as string), ch => ch.charCodeAt(0))]);
    expect(Uint8Array.from(decoded)).toEqual(bytes);
    expect(calls.every(c => c.directory === "CACHE" && c.path.endsWith("/model.io"))).toBe(true);
    expect(Share.share).toHaveBeenCalledWith(expect.objectContaining({ files: ["file:///cache/project.json"] }));
  });
  it("does not report success or share an incomplete file if writing fails", async () => {
    vi.spyOn(Capacitor, "isNativePlatform").mockReturnValue(true);
    vi.mocked(Filesystem.writeFile).mockRejectedValueOnce(new Error("Storage full"));
    await expect(exportFile(new Uint8Array([1]), "../model.json", "application/json")).rejects.toThrow("Storage full");
    expect(Share.share).not.toHaveBeenCalled();
  });
});
