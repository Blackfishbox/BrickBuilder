/** Browser builds stay on their own origin and respect subpath installations. */
export async function requestGeometry(path: string): Promise<Response> {
  return fetch(`${import.meta.env.BASE_URL}api/ldraw/file?path=${encodeURIComponent(path)}`, {
    signal: AbortSignal.timeout(15_000),
    credentials: "omit",
    referrerPolicy: "no-referrer",
    headers: { Accept: "application/octet-stream" },
  });
}
