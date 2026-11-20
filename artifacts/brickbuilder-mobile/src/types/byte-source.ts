export type ByteSource = Uint8Array | AsyncIterable<Uint8Array>;

export function isByteArray(source: ByteSource): source is Uint8Array {
  return Object.prototype.toString.call(source) === "[object Uint8Array]" &&
    typeof (source as Uint8Array).byteLength === "number" &&
    typeof (source as Uint8Array).subarray === "function";
}

export async function* byteChunks(source: ByteSource): AsyncGenerator<Uint8Array> {
  if (isByteArray(source)) {
    yield source;
    return;
  }
  yield* source;
}

export async function collectByteSource(source: ByteSource): Promise<Uint8Array> {
  if (isByteArray(source)) return source;
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of source) {
    chunks.push(chunk);
    size += chunk.byteLength;
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}
