import { jsPDF } from "jspdf";
import { expect, it, vi } from "vitest";
import { drawInstructionPdfFooter } from "./pdf-footer";

it("adds the transparent BrickBuilder logo and localized footer text", async () => {
  const germanPdf = new jsPDF({ unit: "mm", format: "a4" });
  const germanImage = vi.spyOn(germanPdf, "addImage");
  const germanText = vi.spyOn(germanPdf, "text");
  await drawInstructionPdfFooter(germanPdf, "Anleitung erzeugt mit BrickBuilder");
  expect(germanImage).toHaveBeenCalledWith(expect.stringMatching(/^data:image\/png;base64,/),
    "PNG", 16, expect.any(Number), 5.5, 5.5, undefined, "FAST");
  expect(germanText).toHaveBeenCalledWith("Anleitung erzeugt mit BrickBuilder", 23, expect.any(Number));

  const englishPdf = new jsPDF({ unit: "mm", format: "a4" });
  const englishText = vi.spyOn(englishPdf, "text");
  await drawInstructionPdfFooter(englishPdf, "Instructions generated with BrickBuilder");
  expect(englishText).toHaveBeenCalledWith("Instructions generated with BrickBuilder", 23, expect.any(Number));
});
