import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";

/** Fail the native build if a bundled selectable package was omitted or changed. */
export async function verifyDefaultParts(app) {
  const evidence = JSON.parse(await readFile(resolve(app, "src/features/catalog/color-evidence-manifest.json"), "utf8"));
  const evidenceBytes = await readFile(resolve(app, "dist/public", evidence.url));
  if (evidenceBytes.length !== evidence.bytes || createHash("sha256").update(evidenceBytes).digest("hex") !== evidence.sha256) {
    throw new Error("Native release must contain the verified offline part-color evidence.");
  }
  const catalog = JSON.parse(await readFile(resolve(app, "src/features/parts/catalog.json"), "utf8"));
  let count = 0;
  for (const manifest of catalog.filter(pkg => pkg.bundled)) {
    const bytes = await readFile(resolve(app, "dist/public", manifest.url));
    if (bytes.length !== manifest.bytes ||
        createHash("sha256").update(bytes).digest("hex") !== manifest.sha256) {
      throw new Error(`Bundled building package integrity mismatch: ${manifest.id}`);
    }
    count += manifest.partCount;
  }
  if (count < 300) throw new Error("Native release must contain at least 300 selectable parts.");
  console.log(`Verified native offline building packages: ${count} selectable entries.`);
}
