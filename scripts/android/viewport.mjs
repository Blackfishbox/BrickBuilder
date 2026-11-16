/**
 * Capacitor 8 passes system-bar insets through to CSS on recent WebViews when
 * viewport-fit=cover is present, even with SystemBars.insetsHandling=native.
 * Contain keeps the whole native WebView inside the system bars and cutouts.
 */
export function renderAndroidViewport(html) {
  const marker = "viewport-fit=cover";
  if (html.split(marker).length !== 2) {
    throw new Error("Expected exactly one viewport-fit=cover in the Android HTML.");
  }
  return html.replace(marker, "viewport-fit=contain");
}
