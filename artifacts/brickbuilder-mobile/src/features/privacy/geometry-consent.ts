export const GEOMETRY_API = "https://brickbuilder.blackfishbox.de/api";
const KEY = "brickbuilder.remote-geometry.v1";
export const isAndroidBuild = () => import.meta.env.VITE_NATIVE_ANDROID === "true";
/** Fail closed when device storage is unavailable; no network on first launch. */
export function remoteGeometryEnabled(): boolean {
  try { return localStorage.getItem(KEY) === "enabled"; } catch { return false; }
}
export function setRemoteGeometryEnabled(enabled: boolean): boolean {
  try {
    localStorage.setItem(KEY, enabled ? "enabled" : "disabled");
    return remoteGeometryEnabled() === enabled;
  } catch { return false; }
}
export function requireGeometryPermission() {
  if (isAndroidBuild() && !remoteGeometryEnabled()) {
    throw new Error("Online-Nachladen ist deaktiviert. Unter Datenschutz kannst du es optional aktivieren und den Import erneut versuchen.");
  }
}
