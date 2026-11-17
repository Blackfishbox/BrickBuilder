/** Browser builds stay on their own origin and respect subpath installations. */
export async function requestGeometry(path: string): Promise<Response> {
  const url = new URL(
    `${import.meta.env.BASE_URL}api/ldraw/file?path=${encodeURIComponent(path)}`,
    window.location.href,
  );
  try {
    return await fetch(url.href, {
      mode: "same-origin",
      signal: AbortSignal.timeout(15_000),
      credentials: "omit",
      referrerPolicy: "no-referrer",
    });
  } catch (error) {
    if (error instanceof DOMException && ["AbortError", "TimeoutError"].includes(error.name)) {
      throw error;
    }
    const reason = error instanceof Error ? error.message : "Unbekannter Netzwerkfehler";
    const frame = window.top === window.self ? "top-level" : "embedded";
    const serviceWorker = navigator.serviceWorker?.controller?.scriptURL ?? "none";
    throw new TypeError(
      `${reason}. API-Ziel: ${url.origin}${url.pathname}${url.search}; App-Origin: ${window.location.origin}; Frame: ${frame}; Service Worker: ${serviceWorker}`,
    );
  }
}
