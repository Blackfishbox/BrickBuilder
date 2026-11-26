import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { XMLParser } from "fast-xml-parser";
const mock = vi.hoisted(() => ({
  platform: "android",
  yieldExecution: vi.fn(async () => {}),
  openBatteryOptimizationSettings: vi.fn(async () => {}),
  stopped: undefined as undefined | ((event: { jobId: string; reason: string }) => void),
  start: vi.fn(async (_options: { jobId: string }) => {}),
  update: vi.fn(async () => {}),
  stop: vi.fn(async () => {}),
  waitForForeground: vi.fn(async () => {}),
  cancelWait: vi.fn(async () => {}),
  remove: vi.fn(async () => {}),
}));
vi.mock("@capacitor/core", () => ({
  Capacitor: { getPlatform: () => mock.platform },
  registerPlugin: () => ({
    ...mock,
    addListener: async (_event: string, callback: typeof mock.stopped) => {
      mock.stopped = callback; return { remove: mock.remove };
    },
  }),
}));
import { openBatteryOptimizationSettings, withPdfBackgroundExport, yieldPdfExecution } from "./pdf-background";
beforeEach(() => { vi.clearAllMocks(); mock.platform = "android"; });
afterEach(() => { mock.stopped = undefined; vi.restoreAllMocks(); });

it("declares a non-exported, user-started Android file-processing service with bounded-task permissions", () => {
  const source = readFileSync(new URL("../../android/app/src/main/AndroidManifest.xml", import.meta.url), "utf8");
  const manifest = new XMLParser({ ignoreAttributes: false }).parse(source).manifest;
  const permissions = manifest["uses-permission"].map((permission: Record<string, string>) => permission["@_android:name"]);
  expect(permissions).toEqual(expect.arrayContaining([
    "android.permission.FOREGROUND_SERVICE", "android.permission.FOREGROUND_SERVICE_DATA_SYNC",
    "android.permission.WAKE_LOCK", "android.permission.POST_NOTIFICATIONS",
  ]));
  expect(permissions).not.toContain("android.permission.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS");
  expect(manifest.application.service).toMatchObject({
    "@_android:name": ".PdfExportService", "@_android:exported": "false",
    "@_android:foregroundServiceType": "dataSync", "@_android:stopWithTask": "true",
  });
  expect(source).not.toContain("BOOT_COMPLETED");
  const service = readFileSync(new URL("../../android/app/src/main/java/brickbuilder/blackfishbox/de/PdfExportService.java", import.meta.url), "utf8");
  expect(service).toMatch(/MAX_DURATION_MS = 2L \* 60L \* 60L \* 1000L/);
  const plugin = readFileSync(new URL("../../android/app/src/main/java/brickbuilder/blackfishbox/de/PdfExportPlugin.java", import.meta.url), "utf8");
  expect(plugin).toContain("Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS");
  expect(plugin).not.toContain("ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS");
});

it("opens Android's general battery optimization settings without requesting exemption permission", async () => {
  await openBatteryOptimizationSettings();
  expect(mock.openBatteryOptimizationSettings).toHaveBeenCalledOnce();
  mock.platform = "web";
  await openBatteryOptimizationSettings();
  expect(mock.openBatteryOptimizationSettings).toHaveBeenCalledOnce();
});

it("leaves browser exports unchanged and starts no native service", async () => {
  mock.platform = "web";
  const signal = new AbortController().signal, progress = vi.fn();
  const operation = vi.fn(async (current: AbortSignal) => { expect(current).toBe(signal); return "pdf"; });
  expect(await withPdfBackgroundExport("en", signal, progress, operation)).toBe("pdf");
  expect(mock.start).not.toHaveBeenCalled();
});

it("yields through Android only while rendering, then restores browser scheduling", async () => {
  await yieldPdfExecution();
  expect(mock.yieldExecution).not.toHaveBeenCalled();
  await withPdfBackgroundExport("en", new AbortController().signal, vi.fn(), async () => {
    await yieldPdfExecution();
    expect(mock.yieldExecution).toHaveBeenCalledOnce();
  });
  await yieldPdfExecution();
  expect(mock.yieldExecution).toHaveBeenCalledOnce();
});

it("restores browser scheduling after an export error", async () => {
  await expect(withPdfBackgroundExport("en", new AbortController().signal, vi.fn(), async () => {
    await yieldPdfExecution();
    throw new Error("render failed");
  })).rejects.toThrow("render failed");
  await yieldPdfExecution();
  expect(mock.yieldExecution).toHaveBeenCalledOnce();
});

it("protects the cache write, releases the service, then waits to share until foreground", async () => {
  let resume!: () => void;
  mock.waitForForeground.mockImplementationOnce(() => new Promise<void>(resolve => { resume = resolve; }));
  const cacheWrite = vi.fn(), progress = vi.fn(), completed = vi.fn();
  const job = withPdfBackgroundExport("en", new AbortController().signal, progress, async (signal, report) => {
    signal.throwIfAborted();
    report(1, 3); report(2, 3); report(3, 3);
    cacheWrite();
    return "cached.pdf";
  }).then(result => { completed(); return result; });
  await vi.waitFor(() => expect(mock.waitForForeground).toHaveBeenCalledOnce());
  expect(mock.start).toHaveBeenCalledWith(expect.objectContaining({ title: "Creating instruction PDF" }));
  expect(mock.stop).toHaveBeenCalledWith(expect.objectContaining({ success: true, title: "PDF ready" }));
  expect(cacheWrite.mock.invocationCallOrder[0]).toBeLessThan(mock.stop.mock.invocationCallOrder[0]);
  expect(mock.stop.mock.invocationCallOrder[0]).toBeLessThan(mock.waitForForeground.mock.invocationCallOrder[0]);
  expect(progress).toHaveBeenCalledTimes(3);
  expect(mock.update).toHaveBeenCalledTimes(2);
  expect(completed).not.toHaveBeenCalled();
  resume();
  expect(await job).toBe("cached.pdf");
  expect(mock.remove).toHaveBeenCalledOnce();
});

it("stops the service after rendering errors and does not wait for foreground", async () => {
  const failure = new Error("renderer error");
  await expect(withPdfBackgroundExport("en", new AbortController().signal, vi.fn(), async () => { throw failure; }))
    .rejects.toBe(failure);
  expect(mock.stop).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
  expect(mock.waitForForeground).not.toHaveBeenCalled();
  expect(mock.remove).toHaveBeenCalledOnce();
});

it("aborts the renderer on a matching native cancel or timeout but ignores other jobs", async () => {
  let finish!: () => void;
  let runningSignal!: AbortSignal;
  const job = withPdfBackgroundExport("de", new AbortController().signal, vi.fn(), async signal => {
    runningSignal = signal;
    await new Promise<void>(resolve => { finish = resolve; });
    signal.throwIfAborted();
  });
  // Attach rejection handling before triggering the event.
  const outcome = expect(job).rejects.toThrow("PDF-Export wurde");
  await vi.waitFor(() => expect(runningSignal).toBeDefined());
  mock.stopped!({ jobId: "unrelated", reason: "cancelled" });
  expect(runningSignal.aborted).toBe(false);
  mock.stopped!({ jobId: mock.start.mock.calls[0][0].jobId, reason: "timeout" });
  expect(runningSignal.aborted).toBe(true);
  finish(); await outcome;
  expect(mock.stop).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
});

it("forwards user cancellation and prevents concurrent native jobs", async () => {
  const controller = new AbortController();
  let finish!: () => void;
  const job = withPdfBackgroundExport("en", controller.signal, vi.fn(), async signal => {
    await new Promise<void>(resolve => { finish = resolve; });
    signal.throwIfAborted();
  });
  const outcome = expect(job).rejects.toThrow();
  await vi.waitFor(() => expect(finish).toBeDefined());
  await expect(withPdfBackgroundExport("en", controller.signal, vi.fn(), async () => {})).rejects.toThrow("already running");
  controller.abort(); finish(); await outcome;
  expect(mock.stop).toHaveBeenCalledOnce();
});

it("localizes native start failures and releases the single-job guard", async () => {
  mock.start.mockRejectedValueOnce(new Error("ForegroundServiceStartNotAllowedException"));
  const render = vi.fn(async () => "pdf");
  await expect(withPdfBackgroundExport("de", new AbortController().signal, vi.fn(), render))
    .rejects.toThrow("Android konnte den Hintergrundexport nicht starten");
  expect(render).not.toHaveBeenCalled();
  expect(mock.remove).toHaveBeenCalledOnce();
  expect(await withPdfBackgroundExport("en", new AbortController().signal, vi.fn(), render)).toBe("pdf");
});

it("cancels a pending foreground wait without regenerating or restarting the service", async () => {
  const controller = new AbortController();
  let rejectWait!: (error: Error) => void;
  mock.waitForForeground.mockImplementationOnce(() => new Promise<void>((_resolve, reject) => { rejectWait = reject; }));
  mock.cancelWait.mockImplementationOnce(async () => { rejectWait(new Error("PDF_EXPORT_CANCELLED")); });
  const render = vi.fn(async () => "cached.pdf");
  const job = withPdfBackgroundExport("en", controller.signal, vi.fn(), render);
  const outcome = expect(job).rejects.toThrow();
  await vi.waitFor(() => expect(mock.waitForForeground).toHaveBeenCalledOnce());
  controller.abort(); await outcome;
  expect(mock.cancelWait).toHaveBeenCalledOnce();
  expect(mock.stop).toHaveBeenCalledOnce();
  expect(render).toHaveBeenCalledOnce();
});
