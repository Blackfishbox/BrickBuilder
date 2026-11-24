import { afterEach, describe, expect, it, vi } from "vitest";
import { Box3, Euler, Matrix4, Vector3 } from "three";
import { createEmptyDocument, type Brick } from "../editor/model";
import { parseLDraw } from "../formats/ldraw/parser";
import { createSoftwareInstructionRenderer } from "./software-render";
import {
  groupInstructionHighlights, instructionHighlightOccurrences, instructionGroupBounds,
  type InstructionHighlightOccurrence,
} from "./outlines";

const brick = (id: string, x = 0, y = 0, z = 0): Brick =>
  ({ id, type: "brick-2x2", color: "#ff0000", x, y, z, rotation: 0 });
const group = (bricks: Brick[], ids = bricks.map(part => part.id)) =>
  groupInstructionHighlights(instructionHighlightOccurrences(bricks), new Set(ids));
const members = (groups: ReturnType<typeof group>) => groups.map(entry => entry.ids.slice().sort()).sort();

afterEach(() => vi.unstubAllGlobals());

describe("spatial instruction highlight membership", () => {
  it("encloses four neighboring 2x2 bricks in one box without changing occurrences", () => {
    const bricks = [brick("a"), brick("b", 2), brick("c", 0, 0, 2), brick("d", 2, 0, 2)];
    const before = structuredClone(bricks), groups = group(bricks);
    expect(members(groups)).toEqual([["a", "b", "c", "d"]]);
    expect(groups[0].bounds.min.toArray()).toEqual([-1, 0, -1]);
    expect(groups[0].bounds.max.toArray()).toEqual([3, 1.2, 3]);
    expect(bricks).toEqual(before);
  });

  it.each([
    [brick("a"), brick("b", 0, 1.2), brick("c", 0, 2.4), brick("d", 0, 3.6)],
    [brick("a"), brick("b", 2), brick("c", 1, 1.2), brick("d", 1, 2.4, 1)],
    [brick("a"), brick("b", 2), brick("c", 4), brick("d", 6)],
  ])("joins stacked, interlocked, and transitive chains %#", (...bricks) => {
    expect(members(group(bricks))).toEqual([["a", "b", "c", "d"]]);
  });

  it("keeps separated clusters, colors and geometry identities apart", () => {
    const bricks = [
      brick("a"), brick("b", 2), brick("c", 10), brick("d", 12),
      { ...brick("blue", 1), color: "#0000ff" },
      { ...brick("other", 1), type: "brick-1x2" as const },
    ];
    expect(members(group(bricks))).toEqual([["a", "b"], ["blue"], ["c", "d"], ["other"]]);
    expect(members(group([brick("a"), brick("b", 0, 0, 10)]))).toEqual([["a"], ["b"]]);
  });

  it("cannot join through earlier-step bricks, display clearance, or expanded group interiors", () => {
    expect(members(group([brick("a"), brick("old", 2), brick("b", 4)], ["a", "b"]))).toEqual([["a"], ["b"]]);
    expect(group([brick("a"), brick("b", 0, 1.5)])).toHaveLength(2);
    const ring = [brick("a"), brick("b", 2), brick("c", 4), brick("d", 4, 0, 2),
      brick("e", 4, 0, 4), brick("f", 4, 0, 6), brick("g", 2, 0, 6), brick("h", 0, 0, 6)];
    expect(group([...ring, brick("inside", 0, 0, 3)])).toHaveLength(2);
  });

  it("documents a small contact tolerance and ignores screen-space overlap", () => {
    expect(group([brick("a"), brick("b", 2.09)])).toHaveLength(1);
    expect(group([brick("a"), brick("b", 2.11)])).toHaveLength(2);
    expect(group([brick("a"), brick("b", 0, 20, 0)])).toHaveLength(2);
    expect(group([brick("a")], [])).toEqual([]);
  });

  it("keeps membership fixed while combining bounds in final rotated diagram space", () => {
    const occurrences = instructionHighlightOccurrences([brick("a"), brick("b", 2), brick("c", 10)]);
    const groups = groupInstructionHighlights(occurrences, new Set(["a", "b", "c"]));
    for (const angle of [0, 0.7, 1.5]) {
      const rotation = new Matrix4().makeRotationFromEuler(new Euler(0.3, angle, 0.2));
      const boxes = new Map(occurrences.map(part => [part.id, part.bounds.clone().applyMatrix4(rotation)]));
      const combined = instructionGroupBounds(groups, boxes);
      expect(combined).toHaveLength(2);
      expect(combined[0]).toEqual(boxes.get("a")!.clone().union(boxes.get("b")!));
    }
  });

  it("avoids an unconditional all-pairs bounds scan on large steps", () => {
    let reads = 0;
    const entries: InstructionHighlightOccurrence[] = Array.from({ length: 4000 }, (_, i) => {
      const bounds = new Box3(new Vector3(0, i * 3, 0), new Vector3(2, i * 3 + 1, 2));
      return { id: String(i), identity: "same", get bounds() { reads++; return bounds; } };
    });
    expect(groupInstructionHighlights(entries, new Set(entries.map(part => part.id)))).toHaveLength(4000);
    expect(reads).toBeLessThan(4000 * 100);
  });
});

function importedFixture() {
  const document = createEmptyDocument("Grouped highlights");
  const sourceText = [0, 40, 80, 120, 240].map(x => `1 4 ${x} 0 0 1 0 0 0 1 0 0 0 1 test.dat`).join("\n");
  // Two materials in each occurrence deliberately create multiple render batches.
  const content = "0 Test brick\n4 16 -20 0 -20 20 0 -20 20 -24 -20 -20 -24 -20\n4 14 -20 0 20 20 0 20 20 -24 20 -20 -24 20";
  document.imported = { version: 1, format: "mpd", sourceName: "test.mpd", sourceText,
    originalBytes: [], ...parseLDraw(sourceText), resources: {
      "parts/test.dat": { path: "parts/test.dat", content, source: "embedded" },
    }, legalDocuments: [] };
  document.imported.instances.forEach(part => { part.part.status = "resolved"; });
  return document;
}

describe("full-geometry software outlines", () => {
  it.each(["local", "imported"])("draws grouped %s outlines once, including rotated diagrams and toggling", async kind => {
    const document = kind === "imported" ? importedFixture() : createEmptyDocument("Local");
    if (kind === "local") document.bricks = [brick("a"), brick("b", 2), brick("c", 4), brick("d", 6), brick("e", 12)];
    const ids = document.imported?.instances.map(part => part.id) ?? document.bricks.map(part => part.id);
    const context = { save: vi.fn(), restore: vi.fn(), beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(),
      stroke: vi.fn(), fill: vi.fn(), closePath: vi.fn(), fillRect: vi.fn(), strokeStyle: "", lineWidth: 0, globalAlpha: 1, fillStyle: "" };
    const strokeStyles: string[] = [];
    context.stroke.mockImplementation(() => { strokeStyles.push(context.strokeStyle); });
    const canvas = { width: 0, height: 0, getContext: () => context, toDataURL: () => "data:image/jpeg;base64,test" };
    vi.stubGlobal("document", { createElement: () => canvas });
    const before = JSON.stringify(document);
    const renderer = await createSoftwareInstructionRenderer(document);
    try {
      for (const rotation of [[0, 0, 0], [23, 61, -17]] as [number, number, number][]) {
        context.stroke.mockClear();
        strokeStyles.length = 0;
        renderer.image(new Set(ids), { id: "step", title: "", notes: "", partIds: ids, rotation }, new Set(ids));
        expect(strokeStyles.filter(style => style === "#e32620")).toHaveLength(2);
      }
      context.stroke.mockClear();
      strokeStyles.length = 0;
      renderer.image(new Set(ids), { id: "step", title: "", notes: "", partIds: ids });
      expect(strokeStyles.filter(style => style === "#e32620")).toHaveLength(0);
      renderer.image(new Set(ids.slice(0, 1)), { id: "single", title: "", notes: "", partIds: ids }, new Set(ids));
      expect(strokeStyles.filter(style => style === "#e32620")).toHaveLength(1);
      expect(JSON.stringify(document)).toBe(before);
    } finally { renderer.dispose(); }
  });

  it("normalizes imported reference paths but not unrelated geometry or colors", () => {
    const document = importedFixture(), parts = document.imported!.instances;
    parts[1].reference = "TEST.DAT";
    parts[2].colorCode = "14";
    parts[3].reference = "other.dat";
    document.imported!.resources["parts/other.dat"] = {
      ...document.imported!.resources["parts/test.dat"], path: "parts/other.dat",
    };
    const occurrences = instructionHighlightOccurrences([], document.imported);
    expect(members(groupInstructionHighlights(occurrences, new Set(parts.map(part => part.id))))).toEqual(
      [[parts[0].id, parts[1].id].sort(), [parts[2].id], [parts[3].id], [parts[4].id]].sort(),
    );
  });
});
