import { GEOMETRY_API } from "../features/privacy/geometry-consent";

/** Browser builds stay on their own origin and respect subpath installations. */
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

export async function requestGeometry(path: string): Promise<Response> {
  const nativeAndroid = import.meta.env.VITE_NATIVE_ANDROID === "true";
  const endpoint = nativeAndroid
    ? `${GEOMETRY_API.replace(/\/+$/, "")}/ldraw/file?path=${encodeURIComponent(path)}`
    : `${import.meta.env.BASE_URL}api/ldraw/file?path=${encodeURIComponent(path)}`;
  const url = new URL(
    endpoint,
    window.location.href,
  );
  try {
    return await fetch(url.href, {
      mode: nativeAndroid ? "cors" : "same-origin",
      signal: AbortSignal.timeout(15_000),
      credentials: "omit",
      referrerPolicy: "no-referrer",
    });
  } catch (error) {
    if (error instanceof DOMException && ["AbortError", "TimeoutError"].includes(error.name)) {
      throw error;
    }
    const reason = error instanceof Error ? error.message : "Unbekannter Netzwerkfehler";
    try {
      return await xhrGeometryRequest(url.href);
    } catch (xhrError) {
      const xhrReason = xhrError instanceof Error ? xhrError.message : "Unbekannter XHR-Fehler";
      const frame = window.top === window.self ? "top-level" : "embedded";
      const serviceWorker = navigator.serviceWorker?.controller?.scriptURL ?? "none";
      throw new TypeError(
        `${reason}; XHR: ${xhrReason}. API-Ziel: ${url.origin}${url.pathname}${url.search}; App-Origin: ${window.location.origin}; Frame: ${frame}; Service Worker: ${serviceWorker}`,
      );
    }
  }
}
