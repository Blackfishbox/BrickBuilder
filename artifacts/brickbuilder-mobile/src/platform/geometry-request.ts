import { Capacitor, CapacitorHttp } from "@capacitor/core";
import { normalizePath } from "@workspace/ldraw-source";
import { GEOMETRY_API, requireGeometryPermission } from "../features/privacy/geometry-consent";

function withRequestDetails<T>(url: string, request: () => Promise<T>): Promise<T> {
  return request().catch(error => {
    if (error instanceof DOMException && ["AbortError", "TimeoutError"].includes(error.name)) {
      throw error;
    }
    const target = new URL(url, window.location.href);
    const reason = error instanceof Error ? error.message : "Unbekannter Netzwerkfehler";
    throw new TypeError(
      `${reason}. API-Ziel: ${target.origin}${target.pathname}; App-Origin: ${window.location.origin}`,
    );
  });
}

/** Native HTTP avoids weakening the server's browser same-origin restrictions. */
export async function requestGeometry(path: string): Promise<Response> {
  normalizePath(path);
  requireGeometryPermission();
  if (Capacitor.isNativePlatform()) {
    const url = `${GEOMETRY_API}/ldraw/file?path=${encodeURIComponent(path)}`;
    const result = await withRequestDetails(url, () => CapacitorHttp.request({
      url, method: "GET", responseType: "arraybuffer",
      headers: { Accept: "application/octet-stream" },
      connectTimeout: 15_000, readTimeout: 15_000, disableRedirects: true,
    }));
    requireGeometryPermission();
    if (result.url !== url) throw new Error("Unerwartete Weiterleitung der Geometriequelle.");
    const headers = new Headers(result.headers);
    if (result.status !== 200) return new Response(null, { status: result.status, headers });
    // Capacitor returns binary native responses as base64. Bound decoding too.
    const base64 = typeof result.data === "string" ? result.data.replace(/\s/g, "") : "";
    if (!base64.length || base64.length > 4 * Math.ceil(2 * 1024 * 1024 / 3)) {
      throw new Error("Geometrieantwort fehlt oder überschreitet 2 MiB.");
    }
    const bytes = Uint8Array.from(atob(base64), character => character.charCodeAt(0));
    if (bytes.length > 2 * 1024 * 1024) throw new Error("Quelldatei überschreitet 2 MiB.");
    // Existing transport still verifies hashes, origin metadata and licenses.
    return new Response(bytes, { status: result.status, headers });
  }
  const url = `${import.meta.env.BASE_URL}api/ldraw/file?path=${encodeURIComponent(path)}`;
  return withRequestDetails(url, () => fetch(url, {
    signal: AbortSignal.timeout(15_000),
    credentials: "omit",
    referrerPolicy: "no-referrer",
    headers: { Accept: "application/octet-stream" },
  }));
}
