/**
 * Deliberate maintenance: extract identity-only ~Moved to records from an
 * approved official snapshot. Never infer aliases by removing name suffixes.
 * From scripts/: pnpm exec tsx review-ldraw-aliases.ts <approved-directory>
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { inspectFile, OFFICIAL } from "../lib/ldraw-source/src/index";
const directory = process.argv[2];
if (!directory) throw new Error("Provide an approved official LDraw directory.");
const manifest = JSON.parse(readFileSync(resolve(directory, "manifest.json"), "utf8"));
const aliases = [];
for (const path of Object.keys(manifest.files).sort()) {
  if (!/^parts\/[a-z0-9_-]+\.dat$/.test(path)) continue;
  const bytes = readFileSync(resolve(directory, path));
  const text = bytes.toString("utf8");
  const header = text.replace(/^\uFEFF/, "").split(/\r?\n/)[0];
  const target = /^0 ~Moved to ([a-z0-9_-]+)$/i.exec(header)?.[1].toLowerCase();
  if (!target) continue;
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (sha256 !== manifest.files[path]) throw new Error(`Approved source hash changed: ${path}`);
  const file = inspectFile(path, bytes);
  const geometry = file.content.split(/\r?\n/).filter(line => /^[1-5]\s/.test(line.trim()));
  if (geometry.length !== 1) continue;
  const tokens = geometry[0].trim().split(/\s+/);
  if (tokens.length !== 15 || tokens[0] !== "1" || tokens[1] !== "16" ||
      tokens[14].toLowerCase() !== `${target}.dat` ||
      tokens.slice(2, 14).map(Number).join(",") !== "0,0,0,1,0,0,0,1,0,0,0,1" ||
      !manifest.files[`parts/${target}.dat`]) continue;
  aliases.push({
    from: path.slice(6, -4), to: target, sourceUrl: `${OFFICIAL}${path}`,
    sha256, author: file.author, license: file.license, header,
    referenceLine: geometry[0],
  });
}
const byId = new Map(aliases.map(alias => [alias.from, alias]));
const safe = aliases.filter(alias => {
  const seen = new Set<string>();
  let id = alias.from;
  while (byId.has(id)) {
    if (seen.has(id) || seen.size >= 48) return false;
    seen.add(id); id = byId.get(id)!.to;
  }
  return true;
});
const output = resolve(import.meta.dirname, "../artifacts/brickbuilder-mobile/src/features/parts/ldraw-aliases.json");
writeFileSync(output, JSON.stringify({
  version: "2026-11-14", archiveSha256: manifest.sha256,
  sourceUrl: "https://library.ldraw.org/library/updates/complete.zip",
  aliases: safe,
}, null, 2) + "\n");
console.log(`Reviewed ${safe.length} identity-only official aliases.`);
