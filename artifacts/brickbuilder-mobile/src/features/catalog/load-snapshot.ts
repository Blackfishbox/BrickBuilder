/** Keep transport recovery separate from worker validation and application data. */
export async function loadSnapshot<T>(options: {
  url: string;
  expectedBytes: number;
  read(): Promise<Uint8Array | undefined>;
  remove(): Promise<void>;
  save(bytes: Uint8Array): Promise<void>;
  validate(bytes: Uint8Array): Promise<T>;
}): Promise<T> {
  const validate = (bytes: Uint8Array) => {
    if (bytes.length !== options.expectedBytes) {
      const text = new TextDecoder().decode(bytes.subarray(0, 160)).trimStart();
      if (/^(<!doctype html|<html)/i.test(text)) {
        throw new Error("Katalogpfad liefert eine HTML-Seite statt der Katalogdatei. App aktualisieren bzw. Serverpfad prüfen.");
      }
      if (text.startsWith("{")) {
        throw new Error("Katalog wurde als JSON statt als Binärarchiv geliefert. HTTP-Kompression und Serverpfad prüfen.");
      }
      throw new Error(`Kataloggröße stimmt nicht: ${bytes.length} statt ${options.expectedBytes} Bytes. App-Version und bereitgestellte Katalogdatei prüfen.`);
    }
    return options.validate(bytes);
  };
  const stored = await options.read();
  if (stored) {
    try { return await validate(stored); }
    catch {
      // Delete only this invalid snapshot, never projects, inventories or evidence.
      await options.remove();
    }
  }
  // Bypass HTTP caches on every fresh download, including an explicit retry.
  // The .bin path is also a real local asset in Capacitor, not an HTML5 route.
  let response: Response;
  try {
    response = await fetch(options.url, { cache: "no-store", signal: AbortSignal.timeout(30000) });
  } catch (error) {
    throw new Error(`Katalogdatei konnte nicht geladen werden (${error instanceof Error ? error.message : String(error)}). Verbindung prüfen und erneut versuchen; unter Android gegebenenfalls die App aktualisieren.`);
  }
  if (!response.ok) {
    throw new Error(`Katalogdownload: HTTP ${response.status}. ${response.status === 404
      ? "Freigegebene Katalogdatei fehlt; App aktualisieren bzw. Serverpfad prüfen."
      : "Verbindung und Verfügbarkeit der freigegebenen Katalogdatei prüfen, dann erneut versuchen."}`);
  }
  if (response.headers.get("Content-Type")?.includes("text/html")) {
    throw new Error("Katalogpfad liefert eine HTML-Seite statt der Katalogdatei. App aktualisieren bzw. Serverpfad prüfen.");
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  const loaded = await validate(bytes);
  try { await options.save(bytes); }
  catch { throw new Error("Katalog konnte nicht offline gespeichert werden. Bitte freien Browser-Speicher prüfen."); }
  return loaded;
}
