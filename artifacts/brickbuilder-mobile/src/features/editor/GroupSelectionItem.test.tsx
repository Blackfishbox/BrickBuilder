// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { createEmptyDocument } from "./model";
import GroupSelectionItem, { type GroupSelectionTarget } from "./GroupSelectionItem";

const mock = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("../instructions/part-images", () => ({ instructionPartImage: mock.request }));

afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

it("shows the part number, name, and color without row numbering or LDraw text", async () => {
  let intersect!: IntersectionObserverCallback;
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("IntersectionObserver", class {
    constructor(callback: IntersectionObserverCallback) { intersect = callback; }
    observe() {} unobserve() {} disconnect() {}
  });
  mock.request.mockResolvedValue("data:image/png;base64,brick");
  const document = createEmptyDocument();
  const brick = { id: "part-one", type: "brick-2x4" as const, color: "#006400", x: 0, y: 0, z: 0, rotation: 0 };
  const imageEntry = {
    kind: "legacy" as const, part: brick, count: 1, number: "3001",
    colorName: "Dark Green", colorHex: brick.color, key: "legacy-3001-green",
  };
  const target: GroupSelectionTarget = {
    id: brick.id, number: "3001", name: "Classic brick", colorName: "Dark Green",
    colorHex: brick.color, searchText: "3001 Classic brick Dark Green", imageEntry,
  };
  const onChange = vi.fn(), host = window.document.createElement("div"), root = createRoot(host);
  try {
    await act(async () => root.render(
      <GroupSelectionItem target={target} document={{ ...document, bricks: [brick] }} checked={false} onChange={onChange} />,
    ));
    const row = host.querySelector<HTMLElement>('[data-testid="group-selection-item-part-one"]')!;
    expect(row.textContent).toContain("3001 · Classic brick");
    expect(row.textContent).toContain("Dark Green");
    expect(row.textContent).not.toContain("#1");
    expect(row.textContent).not.toContain("LDraw");
    expect(row.querySelector("i")?.style.backgroundColor).toBe("rgb(0, 100, 0)");
    expect(mock.request).not.toHaveBeenCalled();

    await act(async () => intersect([{ target: row.querySelector("span[role=img]")!, isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver));
    await vi.waitFor(() => expect(host.querySelector("img")?.getAttribute("src")).toContain("base64,brick"));
    expect(mock.request).toHaveBeenCalledOnce();

    await act(async () => row.querySelector("input")!.click());
    expect(onChange).toHaveBeenCalledWith(true);
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
