import type { jsPDF } from "jspdf";
import brickBuilderLogo from "../../../public/icons/brickbuilder-192.png?inline";

export async function drawInstructionPdfFooter(pdf: jsPDF, label: string, bottomMargin = 0): Promise<void> {
  const pageHeight = pdf.internal?.pageSize?.getHeight?.() ?? 297;
  const logoSize = 5.5;
  const logoY = bottomMargin >= 12
    ? pageHeight - bottomMargin + (bottomMargin - logoSize) / 2
    : pageHeight - 11.5;

  pdf.saveGraphicsState?.();
  try {
    pdf.addImage(brickBuilderLogo, "PNG", 16, logoY, logoSize, logoSize, undefined, "FAST");
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(7);
    pdf.setTextColor(95);
    pdf.text(label, 23, logoY + 4.2);
  } finally {
    pdf.restoreGraphicsState?.();
  }
}
