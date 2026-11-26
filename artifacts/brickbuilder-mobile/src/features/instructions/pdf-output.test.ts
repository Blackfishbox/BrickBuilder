import { expect, it, vi } from "vitest";
import { jsPDF } from "jspdf";
import { collectByteSource } from "../../types/byte-source";
import { instructionPdfChunks } from "./pdf-output";

vi.mock("../../platform/pdf-background", () => ({ yieldPdfExecution: async () => {} }));

function fixture() {
  const pdf = new jsPDF({ compress: false });
  pdf.setFileId("00112233445566778899aabbccddeeff");
  pdf.text("Instruction 1", 10, 20);
  const width = 640, height = 640;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i++) data[i] = i % 251;
  pdf.addImage({ imageData: { data, width, height }, format: "RGBA", x: 10, y: 30, width: 180, height: 180 });
  pdf.addPage();
  pdf.text("Instruction 2", 10, 20);
  return pdf;
}

it("matches jsPDF byte for byte across binary images and chunk boundaries, including xref offsets", async () => {
  const pdf = fixture();
  const expected = new Uint8Array(pdf.output("arraybuffer"));
  const chunks: Uint8Array[] = [];
  for await (const chunk of instructionPdfChunks(pdf)) chunks.push(chunk);
  expect(chunks.length).toBeGreaterThan(1);
  expect(chunks.every(chunk => chunk.length <= 1024 * 1024)).toBe(true);
  const actual = await collectByteSource((async function* () { yield* chunks; })());
  expect(Buffer.compare(Buffer.from(actual), Buffer.from(expected))).toBe(0);
  const text = Buffer.from(actual).toString("latin1");
  const xref = Number(text.match(/startxref\n(\d+)/)?.[1]);
  expect(text.slice(xref, xref + 4)).toBe("xref");
  expect(text).toContain("/Count 2");
});

it("does not call the full-document output or join when the engine rejects large strings", async () => {
  const pdf = fixture();
  vi.spyOn(pdf, "output").mockImplementation(() => { throw new RangeError("Invalid string length"); });
  const join = Array.prototype.join;
  const spy = vi.spyOn(Array.prototype, "join").mockImplementation(function (this: unknown[], separator?: string) {
    if (this.some(value => typeof value === "string" && value.length > 1024 * 1024)) {
      throw new RangeError("Invalid string length");
    }
    return join.call(this, separator);
  });
  let bytes: Uint8Array;
  try {
    bytes = await collectByteSource(instructionPdfChunks(pdf));
  } finally { spy.mockRestore(); }
  expect(bytes!.length).toBeGreaterThan(1024 * 1024);
  expect(pdf.output).not.toHaveBeenCalled();
});

it("propagates serialization failures instead of returning an empty file and restores the writer", () => {
  const pdf = new jsPDF();
  const writer = (pdf as unknown as { __private__: { buildDocument(): string; resetCustomOutputDestination(): void } }).__private__;
  vi.spyOn(writer, "buildDocument").mockImplementationOnce(() => { throw new RangeError("Invalid string length"); });
  const reset = vi.spyOn(writer, "resetCustomOutputDestination");
  expect(() => instructionPdfChunks(pdf)).toThrow("Invalid string length");
  expect(reset).toHaveBeenCalledOnce();
  expect(new Uint8Array(pdf.output("arraybuffer")).length).toBeGreaterThan(0);
});

it("honors cancellation before serialization and while consuming completed blocks", async () => {
  const controller = new AbortController();
  const source = instructionPdfChunks(fixture(), controller.signal);
  const iterator = source[Symbol.asyncIterator]();
  expect((await iterator.next()).value?.length).toBeGreaterThan(0);
  controller.abort();
  await expect(iterator.next()).rejects.toThrow();
  expect(() => instructionPdfChunks(new jsPDF(), controller.signal)).toThrow();
});
