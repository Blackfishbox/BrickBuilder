import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "brickbuilder.blackfishbox.de",
  appName: "BrickBuilder Mobile",
  webDir: "dist/public",
  server: { androidScheme: "https" },
  android: { allowMixedContent: false, webContentsDebuggingEnabled: false },
  plugins: { SystemBars: { insetsHandling: "native" } },
};
export default config;
