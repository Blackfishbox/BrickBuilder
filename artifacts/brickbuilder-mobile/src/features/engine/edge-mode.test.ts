import { describe, expect, it } from "vitest";
import { nextEdgeMode, readEdgeModePreference } from "./edge-mode";

describe("edge mode preference", () => {
  it("cycles from no edges to thin, thick, then no edges", () => {
    expect(nextEdgeMode("off")).toBe("thin");
    expect(nextEdgeMode("thin")).toBe("thick");
    expect(nextEdgeMode("thick")).toBe("off");
  });

  it("defaults to no edges and migrates the previous boolean preference", () => {
    expect(readEdgeModePreference(null)).toBe("off");
    expect(readEdgeModePreference("false")).toBe("off");
    expect(readEdgeModePreference("true")).toBe("thick");
    expect(readEdgeModePreference("thin")).toBe("thin");
    expect(readEdgeModePreference("unexpected")).toBe("off");
  });
});
