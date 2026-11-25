// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { Capacitor } from "@capacitor/core";
import { Filesystem } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";
import { exportFile, isShareCancelled, prepareExportFile, sharePreparedExport } from "./export-file";
import { renderSvgView } from "../features/engine/svg-view-export";
import { SVG_LIMITS } from "../features/engine/svg-export-buffer";
import { svgCompatibilityFixture } from "../../test-fixtures/svg-compatibility";
import { largeSvgModel } from "../../test-fixtures/large-svg-model";
import { collectByteSource } from "../types/byte-source";

vi.mock("@capacitor/filesystem", () => ({
  Directory: { Cache: "CACHE" },
  Filesystem: { writeFile: vi.fn(), appendFile: vi.fn(), deleteFile: vi.fn(), getUri: vi.fn().mockResolvedValue({ uri: "file:///cache/project.json" }) },
}));
vi.mock("@capacitor/share", () => ({ Share: { share: vi.fn().mockResolvedValue({}) } }));
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  vi.mocked(Filesystem.writeFile).mockReset();
  vi.mocked(Filesystem.appendFile).mockReset();
  vi.mocked(Filesystem.deleteFile).mockReset();
});
describe("local Android exports", () => {
  it("reopens the existing PDF share target without writing the file again", async () => {
    vi.spyOn(Capacitor, "isNativePlatform").mockReturnValue(true);
    const prepared = await prepareExportFile(new Uint8Array([1, 2, 3]), "instructions.pdf", "application/pdf");
    expect(Filesystem.writeFile).toHaveBeenCalledOnce();
    await prepared.share();
    await prepared.share();
    expect(Filesystem.writeFile).toHaveBeenCalledOnce();
    expect(Filesystem.getUri).toHaveBeenCalledOnce();
    expect(Share.share).toHaveBeenCalledTimes(2);
    expect(Share.share).toHaveBeenNthCalledWith(2, expect.objectContaining({
      title: "instructions.pdf",
      files: ["file:///cache/project.json"],
    }));
  });

  it.each(["Share canceled", "Share cancelled", "Sharing canceled by user"])(
    "recognizes Capacitor share dismissal (%s) without mistaking file-write errors for cancellation",
    message => {
      expect(isShareCancelled(new Error(message))).toBe(true);
      expect(isShareCancelled(new Error("Storage full"))).toBe(false);
    },
  );

  it("treats a dismissed Android share chooser as a completed handoff", async () => {
    const prepared = { share: vi.fn().mockRejectedValue(new Error("Share canceled")) };
    await expect(sharePreparedExport(prepared)).resolves.toBeUndefined();
    expect(prepared.share).toHaveBeenCalledOnce();
  });

  it("keeps genuine sharing errors available for the prepared-file retry", async () => {
    const prepared = { share: vi.fn().mockRejectedValue(new Error("No app can open this file")) };
    await expect(sharePreparedExport(prepared)).rejects.toThrow("No app can open this file");
  });

  it("removes a partial PDF cache file when an Android export is cancelled during writing", async () => {
    vi.spyOn(Capacitor, "isNativePlatform").mockReturnValue(true);
    const controller = new AbortController();
    vi.mocked(Filesystem.writeFile).mockImplementationOnce(async () => {
      controller.abort();
      return { uri: "file:///cache/partial.pdf" };
    });
    await expect(prepareExportFile(new Uint8Array(400_000), "Instructions.pdf", "application/pdf", controller.signal))
      .rejects.toThrow();
    expect(Filesystem.deleteFile).toHaveBeenCalledWith(expect.objectContaining({ path: expect.stringContaining("Instructions.pdf") }));
    expect(Share.share).not.toHaveBeenCalled();
  });

  it("reopens exact multi-megabyte SVG bytes after a paused native append", async () => {
    vi.spyOn(Capacitor, "isNativePlatform").mockReturnValue(true);
    const fixture = largeSvgModel(80_001);
    try {
      const bytes = await collectByteSource(renderSvgView([fixture.model], fixture.camera, 2160, 3840));
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
    expect(Filesystem.deleteFile).toHaveBeenCalledOnce();
    const failedPath = vi.mocked(Filesystem.writeFile).mock.calls[0][0].path;
    await exportFile(bytes, "model.svg", "image/svg+xml");
    expect(vi.mocked(Filesystem.writeFile).mock.calls[1][0].path).not.toBe(failedPath);
    expect(Share.share).toHaveBeenCalledOnce();
  });

  it("writes exact chunked bytes and shares a local file without an external upload", async () => {
    vi.spyOn(Capacitor, "isNativePlatform").mockReturnValue(true);
    const bytes = Uint8Array.from({ length: 600_001 }, (_, i) => i % 256);
    async function* source() {
      for (let start = 0; start < bytes.length; start += 73_001) yield bytes.subarray(start, start + 73_001);
    }
    await exportFile(source(), "model.io", "application/octet-stream");
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

  it("turns an async byte stream into one browser download", async () => {
    vi.spyOn(Capacitor, "isNativePlatform").mockReturnValue(false);
    const createObjectURL = vi.fn().mockReturnValue("blob:brickbuilder-test");
    vi.stubGlobal("URL", { createObjectURL, revokeObjectURL: vi.fn() });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    async function* source() {
      yield new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg">');
      yield new TextEncoder().encode("<path d=\"M0 0L1 0L0 1Z\"/></svg>");
    }
    await exportFile(source(), "view.svg", "image/svg+xml");
    const blob = createObjectURL.mock.calls[0][0] as Blob;
    expect(await blob.text()).toBe('<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0L1 0L0 1Z"/></svg>');
    expect(click).toHaveBeenCalledOnce();
  });

  it("downloads the renderer's segmented SVG as one parseable browser file", async () => {
    vi.spyOn(Capacitor, "isNativePlatform").mockReturnValue(false);
    const fixture = svgCompatibilityFixture();
    const originalLimit = SVG_LIMITS.faces;
    Object.defineProperty(SVG_LIMITS, "faces", { value: 3, configurable: true });
    const createObjectURL = vi.fn().mockReturnValue("blob:segmented-svg");
    vi.stubGlobal("URL", { createObjectURL, revokeObjectURL: vi.fn() });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    try {
      await exportFile(
        renderSvgView(fixture.roots, fixture.camera, fixture.width, fixture.height),
        "view.svg",
        "image/svg+xml",
      );
      const blob = createObjectURL.mock.calls[0][0] as Blob;
      const xml = new DOMParser().parseFromString(await blob.text(), "image/svg+xml");
      expect(xml.querySelector("parsererror")).toBeNull();
      expect(xml.querySelectorAll("svg > svg").length).toBeGreaterThan(0);
      expect(xml.documentElement.localName).toBe("svg");
    } finally {
      Object.defineProperty(SVG_LIMITS, "faces", { value: originalLimit, configurable: true });
      fixture.dispose();
    }
  });
});
