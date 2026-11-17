import { Capacitor, CapacitorHttp } from "@capacitor/core";
import { normalizePath } from "@workspace/ldraw-source";
import { GEOMETRY_API, requireGeometryPermission } from "../features/privacy/geometry-consent";

function requestError(url: string, reasons: string[]): TypeError {
  const target = new URL(url, window.location.href);
  const frame = window.top === window.self ? "top-level" : "embedded";
  const serviceWorker = navigator.serviceWorker?.controller?.scriptURL ?? "none";
  return new TypeError(
    `${reasons.join("; ")}. API-Ziel: ${target.origin}${target.pathname}${target.search}; App-Origin: ${window.location.origin}; Frame: ${frame}; Service Worker: ${serviceWorker}`,
  );
}

function withRequestDetails<T>(url: string, request: () => Promise<T>): Promise<T> {
  return request().catch(error => {
    if (error instanceof DOMException && ["AbortError", "TimeoutError"].includes(error.name)) {
      throw error;
    }
    const reason = error instanceof Error ? error.message : "Unbekannter Netzwerkfehler";
    throw requestError(url, [reason]);
  });
}

function xhrGeometryRequest(url: string): Promise<Response> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("GET", url, true);
    request.responseType = "arraybuffer";
    request.timeout = 15_000;
    request.withCredentials = false;
    request.onload = () => {
      if (!request.status || !request.response) {
        reject(new TypeError(`XHR lieferte keinen gültigen HTTP-Status (${request.status}).`));
        return;
      }
      const headers = new Headers();
      for (const line of request.getAllResponseHeaders().trim().split(/[\r\n]+/)) {
        const separator = line.indexOf(":");
        if (separator > 0) {
          headers.append(line.slice(0, separator).trim(), line.slice(separator + 1).trim());
        }
      }
      resolve(new Response(request.response, {
        status: request.status,
        statusText: request.statusText,
        headers,
      }));
    };
    request.onerror = () => reject(new TypeError("XHR-Netzwerkfehler"));
    request.ontimeout = () => reject(new DOMException("Zeitlimit beim Geometrieabruf.", "TimeoutError"));
    request.onabort = () => reject(new DOMException("Geometrieabruf abgebrochen.", "AbortError"));
    request.send();
  });
}

async function browserGeometryRequest(url: string): Promise<Response> {
  try {
    return await fetch(url, {
      mode: "same-origin",
      signal: AbortSignal.timeout(15_000),
      credentials: "omit",
      referrerPolicy: "no-referrer",
    });
  } catch (fetchError) {
    if (fetchError instanceof DOMException && ["AbortError", "TimeoutError"].includes(fetchError.name)) {
      throw fetchError;
    }
    const fetchReason = fetchError instanceof Error ? fetchError.message : "Unbekannter Fetch-Fehler";
    try {
      return await xhrGeometryRequest(url);
    } catch (xhrError) {
      const xhrReason = xhrError instanceof Error ? xhrError.message : "Unbekannter XHR-Fehler";
      throw requestError(url, [fetchReason, `XHR: ${xhrReason}`]);
    }
  }
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
  const url = new URL(
    `${import.meta.env.BASE_URL}api/ldraw/file?path=${encodeURIComponent(path)}`,
    window.location.href,
  ).href;
  return browserGeometryRequest(url);
}
