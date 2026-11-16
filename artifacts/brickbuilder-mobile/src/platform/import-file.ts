import { Capacitor } from "@capacitor/core";

const FILTERS = {
  model: ".io,.ldr,.mpd,.json",
  inventory: ".xml,.csv,text/xml,text/csv",
} as const;

/**
 * Android document providers often label custom model files as octet-stream or
 * ZIP, or omit their MIME type. Extension filters become restrictive MIME
 * filters in WebView and can disable otherwise valid documents.
 * Keep file-name, size and content validation in the importers, not the picker.
 */
export function importFileAccept(kind: keyof typeof FILTERS): string {
  return Capacitor.getPlatform() === "android" ? "*/*" : FILTERS[kind];
}
