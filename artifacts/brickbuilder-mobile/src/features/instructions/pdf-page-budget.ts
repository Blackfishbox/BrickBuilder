import type { jsPDF } from "jspdf";
import { translate, type Locale } from "../../i18n/messages";
import brickBuilderLogo from "../../../public/icons/brickbuilder-192.png?inline";

export const FREE_ANDROID_PDF_PAGES = 10;

/** Stop before allocating or drawing an excluded page, including appendices. */
export class PdfPageBudget {
  private readonly exhausted = new Error("PDF content page budget reached");
  truncated = false;

  constructor(readonly limit = Infinity) {}

  beforeNextPage(pdf: jsPDF): void {
    if (pdf.getNumberOfPages() >= this.limit) {
      this.truncated = true;
      throw this.exhausted;
    }
  }

  async render(content: () => Promise<void>): Promise<void> {
    try { await content(); }
    catch (error) { if (error !== this.exhausted) throw error; }
  }

  appendNotice(pdf: jsPDF, locale: Locale, signal?: AbortSignal): void {
    signal?.throwIfAborted();
    if (!this.truncated) return;
    // An A4 notice remains readable even after a small/custom Studio page.
    pdf.addPage("a4", "portrait");
    pdf.setTextColor(30);
    pdf.addImage(brickBuilderLogo, "PNG", 85, 48, 40, 40, undefined, "FAST");
    pdf.setFont("helvetica", "bold"); pdf.setFontSize(20);
    pdf.text("BrickBuilder Premium", 105, 108, { align: "center" });
    pdf.setFont("helvetica", "normal"); pdf.setFontSize(12);
    const lines = pdf.splitTextToSize(translate(locale, "premium.pdfLimitNotice"), 166);
    pdf.text(lines, 22, 128, { lineHeightFactor: 1.5 });
  }
}
