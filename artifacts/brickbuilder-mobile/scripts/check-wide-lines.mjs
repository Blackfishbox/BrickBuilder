import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

// An opt-in real GPU regression check: mocked WebGL renderers cannot detect
// collapsed triangles or shader compilation errors.
const root = fileURLToPath(new URL("../", import.meta.url));
const output = fileURLToPath(new URL("../../../generated-artifacts/wide-lines/", import.meta.url));
await mkdir(output, { recursive: true });
const profile = await mkdtemp(path.join(tmpdir(), "brickbuilder-edges-"));
const server = await createServer({
  configFile: false, root,
  optimizeDeps: { entries: ["scripts/fixtures/wide-lines.html"] },
  server: { host: "127.0.0.1", port: 0 },
});
try {
  await server.listen();
  const address = server.httpServer.address();
  const url = `http://127.0.0.1:${address.port}/scripts/fixtures/wide-lines.html`;
  const browser = spawn(process.env.CHROMIUM_PATH || "chromium", [
    "--headless", "--no-sandbox", "--disable-dev-shm-usage",
    "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader",
    `--user-data-dir=${profile}`, "--hide-scrollbars", "--window-size=1100,720",
    "--virtual-time-budget=20000", "--run-all-compositor-stages-before-draw",
    `--screenshot=${path.join(output, "comparison.png")}`, "--dump-dom", url,
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
  console.log(result);
  console.log(`GPU comparison: ${path.join(output, "comparison.png")}`);
} finally {
  await server.close();
  await rm(profile, { recursive: true, force: true });
}
