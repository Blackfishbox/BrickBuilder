import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

// An opt-in real GPU regression check: mocked WebGL renderers cannot detect
// collapsed triangles or shader compilation errors.
const root = fileURLToPath(new URL("../", import.meta.url));
const fixture = process.argv[2] || "wide-lines";
assert.ok(["wide-lines", "edge-contrast"].includes(fixture), "Unknown GPU fixture");
const output = fileURLToPath(new URL("../../../generated-artifacts/wide-lines/", import.meta.url));
await mkdir(output, { recursive: true });
const profile = await mkdtemp(path.join(tmpdir(), "brickbuilder-edges-"));
const server = await createServer({
  configFile: false, root,
  resolve: { alias: { "@": path.join(root, "src") } },
  optimizeDeps: { entries: [`scripts/fixtures/${fixture}.html`] },
  server: { host: "127.0.0.1", port: 0 },
});
try {
  await server.listen();
  const address = server.httpServer.address();
  const url = `http://127.0.0.1:${address.port}/scripts/fixtures/${fixture}.html`;
  const browser = spawn(process.env.CHROMIUM_PATH || "chromium", [
    "--headless", "--no-sandbox", "--disable-dev-shm-usage",
    "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader",
    `--user-data-dir=${profile}`, "--hide-scrollbars", "--window-size=1100,720",
    "--virtual-time-budget=20000", "--run-all-compositor-stages-before-draw",
    `--screenshot=${path.join(output, `${fixture}-comparison.png`)}`, "--dump-dom", url,
  ]);
  let stdout = "", stderr = "";
  browser.stdout.on("data", chunk => { stdout += chunk; });
  browser.stderr.on("data", chunk => { stderr += chunk; });
  const timer = setTimeout(() => browser.kill("SIGKILL"), 60_000);
  const code = await new Promise((resolve, reject) => {
    browser.on("error", reject);
    browser.on("close", resolve);
  }).finally(() => clearTimeout(timer));
  assert.equal(code, 0, stderr);
  const result = stdout.match(/<pre id="result"[^>]*>([\s\S]*?)<\/pre>/)?.[1];
  assert.ok(stdout.includes('data-result="passed"'), result || stdout);
  for (const name of ["normal", "studio"]) {
    const bytes = stdout.match(new RegExp(`<pre id="${name}-pdf"[^>]*>([A-Za-z0-9+/=]+)</pre>`))?.[1];
    if (bytes) await writeFile(path.join(output, `${fixture}-${name}.pdf`), Buffer.from(bytes, "base64"));
  }
  console.log(result);
  console.log(`GPU comparison: ${path.join(output, `${fixture}-comparison.png`)}`);
} finally {
  await server.close();
  await rm(profile, { recursive: true, force: true });
}
