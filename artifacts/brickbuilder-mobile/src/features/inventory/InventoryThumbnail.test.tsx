// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import InventoryThumbnail from "./InventoryThumbnail";

const mocks = vi.hoisted(() => ({
  acquire: vi.fn(),
  visible: undefined as undefined | ((visible: boolean) => void),
  update: undefined as undefined | ((value: unknown) => void),
}));
vi.mock("dexie", async importOriginal => ({ ...await importOriginal<typeof import("dexie")>(), liveQuery: () => ({
  subscribe: ({ next }: { next(value: unknown): void }) => {
    mocks.update = next;
    return { unsubscribe: vi.fn() };
  },
}) }));
vi.mock("../parts/thumbnails/visibility", () => ({
  observeThumbnail: (_: Element, callback: (visible: boolean) => void) => {
    mocks.visible = callback;
    return vi.fn();
  },
}));
vi.mock("../parts/thumbnails/acquire", () => ({ acquireThumbnailGeometry: mocks.acquire }));
vi.mock("../parts/PartThumbnail", () => ({
  default: ({ color, colorCode }: { color: string; colorCode: string }) =>
    <img alt="Local rendered preview" data-color={color} data-code={colorCode} />,
}));
let root: ReturnType<typeof createRoot>;
let host: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mocks.acquire.mockReset(); mocks.visible = undefined; mocks.update = undefined;
  host = document.createElement("div"); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); vi.unstubAllGlobals(); });
async function render(acquireMissing = false, color = "#B40000", colorCode = "4") {
  await act(async () => root.render(<InventoryThumbnail ldrawId="99999" color={color}
    colorCode={colorCode} acquireMissing={acquireMissing} />));
}
const missing = { ldrawId: "99999", error: "Keine lokal installierte Vorschaugeometrie verfügbar." };
async function waitFor(check: () => void) {
  await vi.waitFor(async () => { await act(async () => { await Promise.resolve(); }); check(); });
}

it("keeps ordinary inventory previews local-only", async () => {
  await render();
  await act(async () => mocks.update!(missing));
  expect(mocks.visible).toBeUndefined();
  expect(mocks.acquire).not.toHaveBeenCalled();
});

it("acquires visible catalog rows only, cancels hidden work, retries failures and renders cached colors", async () => {
  mocks.acquire.mockImplementation(() => new Promise(() => {}));
  await render(true);
  await act(async () => mocks.update!(missing));
  expect(mocks.acquire).not.toHaveBeenCalled();
  await act(async () => mocks.visible!(true));
  await waitFor(() => expect(mocks.acquire).toHaveBeenCalledTimes(1));
  const signal = mocks.acquire.mock.calls[0][1] as AbortSignal;
  await act(async () => mocks.visible!(false));
  expect(signal.aborted).toBe(true);
  mocks.acquire.mockRejectedValueOnce(new Error("Online-Nachladen ist deaktiviert."));
  await act(async () => mocks.visible!(true));
  await waitFor(() => expect(host.querySelector("button")).not.toBeNull());
  expect(host.textContent).not.toContain("undefined");
  expect(host.querySelector("button")!.title).toContain("deaktiviert");
  mocks.acquire.mockImplementation(() => new Promise(() => {}));
  await act(async () => host.querySelector<HTMLButtonElement>("button")!.click());
  await waitFor(() => expect(mocks.acquire).toHaveBeenCalledTimes(3));
  await act(async () => mocks.update!({ ldrawId: "99999", part: { id: "cached" }, revision: "snapshot:1" }));
  expect(host.querySelector("img")?.dataset.color).toBe("#B40000");
  expect(host.querySelector("button")).toBeNull();
  await render(true, "#1E5AA8", "1");
  expect(host.querySelector("img")?.dataset.code).toBe("1");
  expect(mocks.acquire).toHaveBeenCalledTimes(3);
});
