// Explicit maintenance only: no live-source fallback is enabled in the app.
// Files and original credits were reviewed on 2026-11-14. Changed upstream
// bytes must be reviewed again rather than silently updating these pins.
import { readFile, writeFile } from "node:fs/promises";
import { gzipSync, gunzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const app = resolve(root, "artifacts/brickbuilder-mobile");
const manifest = JSON.parse(await readFile(resolve(app, "src/features/formats/geometry-manifest.json"), "utf8"));
const output = resolve(app, "public", manifest.url);
const snapshot = JSON.parse(gunzipSync(await readFile(output)));
const sources = [
  ["parts/5844.dat", "unofficial", "fff4b7dfa90dd38fef81efe381be295a7d8442f5c3b181c45b95495e5400b73d", "5844-unofficial.dat"],
  ["p/48/1-4cylo.dat", "official", "93f7305e7575678ae00336972ca5078611c37a02d9755865d38cea4ff122c345", "1-4cylo.dat"],
  ["p/48/1-4ndis.dat", "official", "4359a309a22272c7b82b284b28c99bcc0a120c34e5ea6351e59da356890b84bf", "1-4ndis.dat"],
];
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
for (const [path, status, sha256, localName] of sources) {
  const sourceUrl = `https://library.ldraw.org/library/${status}/${path}`;
  let bytes;
  if (process.argv[2]) bytes = await readFile(resolve(process.argv[2], localName));
  else {
    const response = await fetch(sourceUrl, { signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error(`${sourceUrl}: HTTP ${response.status}`);
    bytes = Buffer.from(await response.arrayBuffer());
  }
  if (hash(bytes) !== sha256) throw new Error(`Reviewed source hash changed: ${path}`);
  const content = bytes.toString("utf8");
  const author = content.split(/\r?\n/).find(line => line.startsWith("0 Author: "))?.slice(10);
  if (!author || !content.includes("0 !LICENSE Licensed under CC BY 4.0 : see CAreadme.txt"))
    throw new Error(`Missing reviewed license or author: ${path}`);
  const file = { path, content, sourceUrl, author, license: "CC-BY-4.0", sha256, byteLength: bytes.length };
  snapshot.files = snapshot.files.filter(existing => existing.path !== path);
  snapshot.files.push(file);
}
if (!snapshot.parts.some(part => part.ldrawId === "5844")) snapshot.parts.push({
  ldrawId: "5844", name: "Arch 1 x 4 x 2.333 with Curved Top", file: "parts/5844.dat",
});
// Verify the full dependency closure before emitting any new bundle.
const byPath = new Map(snapshot.files.map(file => [file.path, file]));
const visited = new Set();
function visit(path) {
  if (visited.has(path)) return;
  visited.add(path);
  const file = byPath.get(path);
  if (!file) throw new Error(`Incomplete reviewed closure: ${path}`);
  for (const line of file.content.split(/\r?\n/).filter(line => /^\s*1\s/.test(line))) {
    const ref = line.trim().split(/\s+/).slice(14).join(" ").replaceAll("\\", "/").toLowerCase();
    const child = [`parts/${ref}`, `p/${ref}`].find(candidate => byPath.has(candidate));
    if (!child) throw new Error(`Missing reviewed dependency: ${path} → ${ref}`);
    visit(child);
  }
}
visit("parts/5844.dat");
const bytes = gzipSync(JSON.stringify(snapshot), { level: 9 });
await writeFile(output, bytes);
console.log(JSON.stringify({
  bytes: bytes.length, sha256: hash(bytes), partCount: snapshot.parts.length, fileCount: snapshot.files.length,
  reviewedClosureFiles: visited.size,
}, null, 2));
