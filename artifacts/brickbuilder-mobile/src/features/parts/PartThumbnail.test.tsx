// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import PartThumbnail from "./PartThumbnail";
import type { LibraryPart } from "./types";

const mock = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("./thumbnails/service", () => ({ requestThumbnail: mock.request }));
const part: LibraryPart = {
  id: "test:3001", ldrawId: "3001", packageId: "test", name: "Brick 2 x 4",
  category: "Steine", keywords: [], file: "parts/3001.dat",
};
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

it("loads visible rows only, aborts outdated colors and does not display stale images", async () => {
  let intersect!: IntersectionObserverCallback;
  const disconnect = vi.fn();
  vi.stubGlobal("IntersectionObserver", class {
    constructor(callback: IntersectionObserverCallback) { intersect = callback; }
    observe() {} unobserve() {} disconnect = disconnect;
  });
  let redDone!: (value: string) => void;
  mock.request.mockImplementationOnce(() => new Promise<string>(done => { redDone = done; }))
    .mockResolvedValueOnce("data:image/png;base64,blue");
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(<PartThumbnail part={part} revision="v1" color="#B40000" colorCode="4" />));
    expect(mock.request).not.toHaveBeenCalled();
    const target = host.firstElementChild!;
    await act(async () => intersect([{ target, isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver));
    await vi.waitFor(() => expect(mock.request).toHaveBeenCalledTimes(1));
    const oldSignal = mock.request.mock.calls[0][4] as AbortSignal;
    await act(async () => root.render(<PartThumbnail part={part} revision="v1" color="#1E5AA8" colorCode="1" />));
    await vi.waitFor(() => expect(host.querySelector("img")?.getAttribute("src")).toContain("blue"));
    expect(oldSignal.aborted).toBe(true);
    await act(async () => redDone("data:image/png;base64,red"));
    expect(host.querySelector("img")?.getAttribute("src")).toContain("blue");
    await act(async () => intersect([{ target, isIntersecting: false } as IntersectionObserverEntry], {} as IntersectionObserver));
    expect(host.querySelector("img")).toBeNull();
  } finally {
    await act(async () => root.unmount()); host.remove();
  }
  expect(disconnect).toHaveBeenCalled();
});

it("shows a truthful failure without disabling the parent part button", async () => {
  let intersect!: IntersectionObserverCallback;
  vi.stubGlobal("IntersectionObserver", class {
    constructor(callback: IntersectionObserverCallback) { intersect = callback; }
    observe() {} unobserve() {} disconnect() {}
  });
  mock.request.mockRejectedValue(new Error("Lokale Vorschaugeometrie fehlt"));
  const select = vi.fn();
  const host = document.createElement("div");
  const root = createRoot(host);
  try {
    await act(async () => root.render(<button onClick={select}>
      <PartThumbnail part={part} revision="v1" color="#B40000" />
    </button>));
    await act(async () => intersect([{ target: host.querySelector("span"), isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver));
    await vi.waitFor(() => expect(host.querySelector('[role="img"]')?.getAttribute("aria-label")).toBe("Vorschau nicht verfügbar"));
    await act(async () => host.querySelector("button")!.click());
    expect(select).toHaveBeenCalledOnce();
  } finally { await act(async () => root.unmount()); }
});
