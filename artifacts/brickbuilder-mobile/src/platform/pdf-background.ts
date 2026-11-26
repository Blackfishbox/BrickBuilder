import { Capacitor, registerPlugin, type PluginListenerHandle } from "@capacitor/core";
import { translate, type Locale } from "../i18n/messages";

interface PdfExportPlugin {
  yieldExecution(): Promise<void>;
  start(options: { jobId: string; title: string; text: string; channel: string; cancel: string }): Promise<void>;
  update(options: { jobId: string; done: number; total: number; text: string }): Promise<void>;
  stop(options: { jobId: string; success: boolean; title: string; text: string }): Promise<void>;
  waitForForeground(options: { jobId: string }): Promise<void>;
  cancelWait(options: { jobId: string }): Promise<void>;
  addListener(event: "stopped", listener: (event: { jobId: string; reason: string }) => void): Promise<PluginListenerHandle>;
}
const native = registerPlugin<PdfExportPlugin>("PdfExport");
let active = false;
let rendering = false;

/** Hidden WebView timers can be throttled even while a foreground service runs. */
export async function yieldPdfExecution(): Promise<void> {
  if (rendering) await native.yieldExecution();
  else await new Promise<void>(resolve => setTimeout(resolve, 0));
}

/** Protect rendering AND the cache-file write; sharing must wait until the activity resumes. */
export async function withPdfBackgroundExport<T>(
  locale: Locale, signal: AbortSignal, onProgress: (done: number, total: number) => void,
  operation: (signal: AbortSignal, progress: (done: number, total: number) => void) => Promise<T>,
): Promise<T> {
  signal.throwIfAborted();
  if (Capacitor.getPlatform() !== "android") return operation(signal, onProgress);
  if (active) throw new Error(translate(locale, "instruction.background.busy"));
  active = true;
  const jobId = crypto.randomUUID(), controller = new AbortController();
  const abort = () => controller.abort(signal.reason);
  signal.addEventListener("abort", abort, { once: true });
  let listener: PluginListenerHandle | undefined, started = false, success = false, stopped = false;
  let lastUpdate = -Infinity;
  try {
    listener = await native.addListener("stopped", event => {
      if (event.jobId === jobId) controller.abort(new Error(translate(locale, "instruction.background.stopped")));
    });
    controller.signal.throwIfAborted();
    try {
      await native.start({
        jobId, title: translate(locale, "instruction.background.title"),
        text: translate(locale, "instruction.background.working"),
        channel: translate(locale, "instruction.background.channel"),
        cancel: translate(locale, "instruction.background.cancel"),
      });
      started = true;
      rendering = true;
    } catch {
      throw new Error(translate(locale, "instruction.background.unavailable"));
    }
    controller.signal.throwIfAborted();
    const result = await operation(controller.signal, (done, total) => {
      onProgress(done, total);
      const now = performance.now();
      if (now - lastUpdate < 1000 && done < total) return;
      lastUpdate = now;
      void native.update({
        jobId, done, total, text: translate(locale, "instruction.exporting", { done, total }),
      }).catch(error => console.warn("PDF notification update failed", error));
    });
    controller.signal.throwIfAborted();
    success = true;
    rendering = false;
    await native.stop({
      jobId, success, title: translate(locale, "instruction.background.readyTitle"),
      text: translate(locale, "instruction.background.ready"),
    });
    stopped = true;
    // The file already exists. Do not hold a wake lock while waiting for sharing.
    const cancelWait = () => { void native.cancelWait({ jobId }).catch(console.warn); };
    controller.signal.addEventListener("abort", cancelWait, { once: true });
    try {
      controller.signal.throwIfAborted();
      await native.waitForForeground({ jobId });
      controller.signal.throwIfAborted();
    } finally { controller.signal.removeEventListener("abort", cancelWait); }
    return result;
  } finally {
    rendering = false;
    if (started && !stopped) {
      try { await native.stop({ jobId, success: false, title: "", text: "" }); }
      catch (error) { console.error("PDF background service cleanup failed", error); }
    }
    signal.removeEventListener("abort", abort);
    try { await listener?.remove(); } finally { active = false; }
  }
}
