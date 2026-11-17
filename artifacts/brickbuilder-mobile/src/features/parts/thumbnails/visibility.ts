const listeners = new Map<Element, (visible: boolean) => void>();
let observer: IntersectionObserver | undefined;

/** Share the observer as well as the renderer across all rows. */
export function observeThumbnail(element: Element, listener: (visible: boolean) => void) {
  if (typeof IntersectionObserver === "undefined") {
    // Older WebViews get an explicit unavailable state, not eager catalog work.
    return () => {};
  }
  observer ??= new IntersectionObserver(entries => {
    for (const entry of entries) listeners.get(entry.target)?.(entry.isIntersecting);
  }, { rootMargin: "48px" });
  listeners.set(element, listener);
  observer.observe(element);
  return () => {
    observer?.unobserve(element);
    listeners.delete(element);
    if (!listeners.size) { observer?.disconnect(); observer = undefined; }
  };
}
