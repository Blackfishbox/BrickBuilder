import type { BuilderDocument } from "../features/editor/model";
import type { InstructionPlan } from "../features/instructions/types";
import { translate, type Locale } from "../i18n/messages";
import { isGeneratedProjectName } from "../i18n/project-name";
import { prepareExportFile, sharePreparedExport, type PreparedExport } from "./export-file";
import { withPdfBackgroundExport } from "./pdf-background";
import type { ByteSource } from "../types/byte-source";
import { premiumActive } from "../features/premium/store";
import { FREE_ANDROID_PDF_PAGES } from "../features/instructions/pdf-page-budget";

export async function exportInstructionPdfFile(options: {
  document: BuilderDocument; plan: InstructionPlan; locale: Locale; signal: AbortSignal;
  highlight: boolean; studio?: boolean; omitBranding?: boolean;
  onProgress: (done: number, total: number) => void;
  onPrepared: (file: PreparedExport) => void;
}): Promise<void> {
  const { document, plan, locale, signal, highlight, onProgress, studio, onPrepared } = options;
  const premium = premiumActive();
  const omitBranding = Boolean(options.omitBranding && premium);
  const maxContentPages = import.meta.env.VITE_NATIVE_ANDROID === "true" && !premium
    ? FREE_ANDROID_PDF_PAGES : undefined;
  const prepared = await withPdfBackgroundExport(locale, signal, onProgress, async (jobSignal, progress) => {
    const exportPdf = studio
      ? (await import("../features/instructions/studio-pdf")).exportStudioLayoutPdfChunks
      : (await import("../features/instructions/pdf")).exportInstructionPdfChunks;
    let bytes: ByteSource;
    try { bytes = await exportPdf(document, plan, { signal: jobSignal, onProgress: progress, highlight, locale, omitBranding, maxContentPages }); }
    catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "PDF_WEBGL_CONTEXT_LOST") {
        throw new Error(translate(locale, "instruction.background.contextLost"));
      }
      throw error;
    }
    jobSignal.throwIfAborted();
    const title = isGeneratedProjectName(document.name) ? translate(locale, "project.new") : document.name;
    const name = title.replace(/[^a-zA-Z0-9_-]/g, "_") || translate(locale, "project.new");
    const suffix = studio ? "Studio-Layout" : translate(locale, "instruction.pdf.filename");
    const file = await prepareExportFile(bytes, `${name}-${suffix}.pdf`, "application/pdf", jobSignal);
    onPrepared(file);
    return file;
  });
  signal.throwIfAborted();
  await sharePreparedExport(prepared);
}
