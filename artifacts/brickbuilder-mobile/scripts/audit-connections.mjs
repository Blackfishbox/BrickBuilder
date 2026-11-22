import { fileURLToPath } from "node:url";
import { createServer } from "vite";

process.env.PORT ??= "23048";
process.env.BASE_PATH ??= "/";

const server = await createServer({
  configFile: fileURLToPath(new URL("../vite.config.ts", import.meta.url)),
  server: { middlewareMode: true },
  appType: "custom",
});

try {
  await server.ssrLoadModule("/src/features/connections/audit.ts");
} finally {
  await server.close();
}
