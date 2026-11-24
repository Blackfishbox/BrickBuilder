import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

// Opt-in real WebGL/PDF check; no uploaded model is copied into the source tree.
const root = fileURLToPath(new URL("../", import.meta.url));
const model = process.argv[2];
if (!model) throw new Error("Pass the absolute path of a local IO model.");
const out = path.resolve(root, "../../generated-artifacts/instruction-review");
await mkdir(out, { recursive: true });
const profile = await mkdtemp("/tmp/brickbuilder-instruction-review-");
const saveOutput = async (req, res) => {
  try {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    await writeFile(path.join(out, "instructions-review.pdf"), Buffer.concat(chunks));
    res.end("ok");
  } catch (error) { res.statusCode = 500; res.end(String(error)); }
};
const server = await createServer({
  configFile: false, root, resolve: { alias: { "@": path.join(root, "src") } },
  plugins: [{ name: "local-review-output", configureServer(server) {
    server.middlewares.use("/__review-output", saveOutput);
  } }],
  optimizeDeps: { entries: ["scripts/fixtures/instruction-review.html"] },
  server: {
    host: "127.0.0.1", port: 0,
    proxy: { "/api": { target: "https://brickbuilder.blackfishbox.de", changeOrigin: true } },
  },
});
try {
  await server.listen();
  const { port } = server.httpServer.address();
  const url = `http://127.0.0.1:${port}/scripts/fixtures/instruction-review.html?model=${encodeURIComponent(`/@fs${path.resolve(model)}`)}`;
  const browser = spawn(process.env.CHROMIUM_PATH || "chromium", [
    "--headless", "--no-sandbox", "--disable-dev-shm-usage", "--enable-logging=stderr",
    "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader",
    `--user-data-dir=${profile}`, "--hide-scrollbars", "--window-size=1060,1100",
    "--remote-debugging-port=0", "about:blank",
  ]);
  let stderr = "";
  const timer = setTimeout(() => browser.kill("SIGKILL"), 150000);
  let socket;
  try {
    const endpoint = await new Promise((resolve, reject) => {
      browser.stderr.on("data", chunk => {
        stderr += chunk;
        const match = stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/);
        if (match) resolve(match[1]);
      });
      browser.on("error", reject);
      browser.on("exit", code => reject(new Error(`Chromium exited: ${code}`)));
    });
    socket = new WebSocket(endpoint);
    await new Promise((resolve, reject) => { socket.addEventListener("open", resolve); socket.addEventListener("error", reject); });
    let id = 0;
    const pending = new Map();
    socket.addEventListener("message", event => {
      const data = JSON.parse(event.data), callback = pending.get(data.id);
      if (!callback) return;
      pending.delete(data.id);
      if (data.error) callback.reject(new Error(JSON.stringify(data.error))); else callback.resolve(data.result);
    });
    const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
      const requestId = ++id;
      pending.set(requestId, { resolve, reject });
      socket.send(JSON.stringify({ id: requestId, method, params, sessionId }));
    });
    const { targetId } = await send("Target.createTarget", { url });
    const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
    const evaluation = await send("Runtime.evaluate", {
      expression: `(async()=>{const start=Date.now();while(!document.body?.dataset.result&&Date.now()-start<120000)await new Promise(r=>setTimeout(r,200));return {state:document.body?.dataset.result,message:document.querySelector('#result')?.textContent};})()`,
      awaitPromise: true, returnByValue: true,
    }, sessionId);
    const result = evaluation.result.value;
    const screenshot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true }, sessionId);
    await writeFile(path.join(out, "comparison.png"), Buffer.from(screenshot.data, "base64"));
    console.log(result);
    if (result?.state !== "passed") {
      console.error(stderr.split("\n").filter(line => /CONSOLE|ERROR.*(shader|GPU)/i.test(line)).join("\n"));
      process.exitCode = 1;
    }
    await send("Browser.close");
  } finally { clearTimeout(timer); socket?.close(); browser.kill(); }
} finally { await server.close(); await rm(profile, { recursive: true, force: true, maxRetries: 4, retryDelay: 250 }); }
