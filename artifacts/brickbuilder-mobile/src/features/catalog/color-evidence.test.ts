import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { gunzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { evidencePalette, indexColorEvidence, partColorEvidence, selectionColorEvidence, type ColorEvidenceData } from "./color-evidence";
import manifest from "./color-evidence-manifest.json";
import coverage from "../../../docs/part-color-coverage.json";

export function fixture(): ColorEvidenceData {
  return { schema: 1, version: "test", snapshotDate: "2026-11-16",
    ldParts: [["base", "rb-base"], ["basep01", "rb-print"], ["second", "rb-second"],
      ["ambiguous", "rb-base"], ["ambiguous", "rb-print"], ["without-pairs", "rb-empty"]],
    ldColors: [["4", "100", "True", "True"], ["1", "101", "True", "True"],
      ["7", "102", "True", "True"], ["7", "103", "True", "True"],
      ["8", "104", "False", "True"], ["9", "105", "True", "False"]],
    pairs: { "rb-base": ["100", "101"], "rb-print": ["101"],
      "rb-second": ["100", "999"], "rb-unmapped": ["998"] },
  };
}
describe("observed part-color evidence", () => {
  it("uses only exact LD imports, retaining printed variants and namespaces", () => {
    const index = indexColorEvidence(fixture());
    expect(partColorEvidence("BASE.DAT", index)).toMatchObject({ status: "known", codes: ["4", "1"] });
    expect(partColorEvidence("basep01", index)).toMatchObject({ status: "known", codes: ["1"] });
    for (const id of ["basep02", "rb-base", "without-pairs", "constructor", "base/extra"]) {
      expect(partColorEvidence(id, index).status).toBe("unknown");
    }
    expect(partColorEvidence("ambiguous", index)).toEqual({ status: "ambiguous", candidates: ["rb-base", "rb-print"] });
    expect(partColorEvidence("base").status).toBe("unknown");
  });
  it("does not translate ambiguous, input-only, or absent color IDs by number or RGB", () => {
    const data = fixture();
    data.pairs["rb-base"] = ["102", "104", "105", "12345"];
    expect(partColorEvidence("base", indexColorEvidence(data))).toMatchObject({
      status: "known", codes: [], unmappedColors: ["102", "104", "105", "12345"],
    });
  });
  it("intersects only known constraints, including mixed and disjoint selections", () => {
    const index = indexColorEvidence(fixture());
    expect(selectionColorEvidence(["base", "second", "unknown", "ambiguous"], index)).toMatchObject({
      codes: ["4"], known: 2, unknown: 1, ambiguous: 1, unmappedColors: 1,
    });
    expect(selectionColorEvidence(["second", "basep01"], index).codes).toEqual([]);
    expect(selectionColorEvidence(["unknown", "ambiguous"], index).codes).toBeUndefined();
    expect(selectionColorEvidence(["base", "BASE.dat"], index).known).toBe(1);
  });
  it("retains absent snapshot colors as current, not selectable evidence", () => {
    const palette = [{ ldrawCode: "4", name: "Red", value: "#ff0000" }, { ldrawCode: "1", name: "Blue", value: "#0000ff" }];
    const current = [{ ldrawCode: "0x2ABCDEF", name: "Imported", value: "#ABCDEF" }, palette[1]];
    const before = JSON.stringify(current);
    expect(evidencePalette(palette, ["4"], current)).toEqual({ visible: [palette[0]], preserved: current });
    expect(evidencePalette(palette, undefined, current)).toEqual({ visible: palette, preserved: [current[0]] });
    expect(JSON.stringify(current)).toBe(before);
  });
  it("rejects malformed snapshots and unknown-color sentinels", () => {
    const data = fixture(); data.schema = 3 as 1;
    expect(() => indexColorEvidence(data)).toThrow();
    const invalid = fixture(); invalid.ldColors.push(["4", "-1", "True", "True"]);
    expect(() => indexColorEvidence(invalid)).toThrow();
  });
  it("ships the pinned observations locally without network or the old ID catalog", () => {
    const bytes = readFileSync(`public/${manifest.url}`);
    expect(bytes.length).toBe(manifest.bytes);
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(manifest.sha256);
    const data = JSON.parse(new TextDecoder().decode(gunzipSync(bytes)));
    const index = indexColorEvidence(data);
    expect(index.snapshotDate).toBe(manifest.snapshotDate);
    expect(Object.keys(index.pairs)).toHaveLength(manifest.coverage.parts);
    expect(Object.values(index.pairs).reduce((sum, colors) => sum + colors.length, 0)).toBe(manifest.coverage.pairs);
    expect(partColorEvidence("3001", index).status).toBe("known");
    expect(partColorEvidence("3001p99", index).status).toBe("unknown");
    expect(data.schema).toBe(2);
    expect(index.pairsBySource.elements["3023a"]).toBeUndefined();
    expect(index.pairsBySource.setInventories["3023a"]).toContain("4");
    expect(partColorEvidence("3023a", index).status).toBe("known");
    // Same number, no exact import mapping: do not borrow the variant's evidence.
    expect(partColorEvidence("3023", index).status).toBe("unknown");
    expect(partColorEvidence("5787", index).status).toBe("unknown");
    expect(coverage.defaultLibrary.counts.known).toBe(293);
    expect(coverage.additionalCoverage.newlyKnownCount).toBe(14);
    const baseline = indexColorEvidence({ ...data, schema: 1, pairs: data.pairsBySource.elements });
    expect(Object.keys(baseline.pairs)).toHaveLength(47883);
    expect(Object.values(baseline.pairs).reduce((sum, values) => sum + values.length, 0)).toBe(89136);
    for (const id of coverage.elementOnlyDefaultLibrary.ids.known) {
      const previous = partColorEvidence(id, baseline);
      const next = partColorEvidence(id, index);
      expect(previous.status).toBe("known");
      expect(next.status).toBe("known");
      if (previous.status === "known" && next.status === "known") {
        expect(next.codes).toEqual(expect.arrayContaining(previous.codes));
      }
    }
    for (const id of coverage.defaultLibrary.ids.known) {
      expect(partColorEvidence(id, index)).toMatchObject({ status: "known" });
    }
    for (const id of [...coverage.defaultLibrary.ids.noObservations, ...coverage.defaultLibrary.ids.noMapping]) {
      expect(partColorEvidence(id, index).status).toBe("unknown");
    }
    for (const id of coverage.additionalCoverage.newlyKnownIds) {
      expect(partColorEvidence(id, baseline).status).toBe("unknown");
      expect(partColorEvidence(id, index).status).toBe("known");
    }
  });
  it("unions source observations without resolving ambiguous identities or inventing colors", () => {
    const data = fixture();
    data.schema = 2;
    data.pairsBySource = { elements: structuredClone(data.pairs),
      setInventories: { "rb-empty": ["101"], "rb-base": ["102"] },
      minifigInventories: { "rb-print": ["100"] } };
    data.pairs["rb-empty"] = ["101"];
    data.pairs["rb-base"].push("102");
    data.pairs["rb-print"].push("100");
    const before = JSON.stringify(data);
    const index = indexColorEvidence(data);
    expect(partColorEvidence("without-pairs", index)).toMatchObject({ status: "known", codes: ["1"] });
    expect(partColorEvidence("basep01", index)).toMatchObject({ status: "known", codes: ["1", "4"] });
    expect(partColorEvidence("ambiguous", index).status).toBe("ambiguous");
    expect(partColorEvidence("rb-empty", index).status).toBe("unknown");
    expect(partColorEvidence("base", index)).toMatchObject({ codes: ["4", "1"], unmappedColors: ["102"] });
    expect(JSON.stringify(data)).toBe(before);
    delete data.pairsBySource.setInventories["rb-empty"];
    expect(() => indexColorEvidence(data)).toThrow("Widersprüchliche Herkunft");
  });
  it("rejects missing, malformed and unrecognized source provenance", () => {
    const data = fixture(); data.schema = 2;
    expect(() => indexColorEvidence(data)).toThrow("Fehlende Farbnachweisquellen");
    data.pairsBySource = { elements: data.pairs, setInventories: {}, minifigInventories: {} };
    data.pairsBySource.setInventories["p"] = ["-1"];
    expect(() => indexColorEvidence(data)).toThrow("Ungültige Teil-Farb");
    data.pairsBySource.setInventories = {};
    Object.assign(data.pairsBySource, { guessed: {} });
    expect(() => indexColorEvidence(data)).toThrow("Fehlende Farbnachweisquellen");
  });
});
