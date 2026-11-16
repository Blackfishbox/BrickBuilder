import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "brickbuilder.blackfishbox.de",
  appName: "BrickBuilder Mobile",
  webDir: "dist/public",
  server: { androidScheme: "https" },
  android: { allowMixedContent: false, webContentsDebuggingEnabled: false },
  // MainActivity owns native padding; avoid a competing decor/CSS inset listener.
  plugins: { SystemBars: { insetsHandling: "disable" } },
};
export default config;
