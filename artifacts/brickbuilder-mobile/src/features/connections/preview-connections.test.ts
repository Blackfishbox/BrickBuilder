import { describe, expect, it } from "vitest";
import { activeConnections, previewConnections, snapConnection } from "./engine";
import { connectionFixture, partLine } from "./fixtures";

describe("connection preview", () => {
  it("suggests a free compatible contact just before magnetic capture", () => {
    const model = connectionFixture([
      partLine("3001", 0, -24),
      partLine("3003", 160, -24),
    ].join("\n"));
    const movingId = model.instances[1].id;
    const desired = Array.from({ length: 17 }, (_, i) => ({ x: 0, y: 2.3 + i * 0.25, z: 0 }))
      .find(position => !snapConnection(model, movingId, position) && previewConnections(model, movingId, position).length > 0);
    expect(desired).toBeDefined();
    const suggestions = previewConnections(model, movingId, desired!);

    expect(suggestions.length).toBeGreaterThan(0);
    expect(suggestions.every(contact => contact.state === "candidate")).toBe(true);
    expect(suggestions.every(contact => contact.targetId === model.instances[0].id)).toBe(true);
    expect(suggestions.every(contact => Number.isFinite(contact.position[1]))).toBe(true);
  });

  it("does not suggest occupied target connectors", () => {
    let model = connectionFixture([
      partLine("3001", 0, -24),
      partLine("3003", 160, -24),
      partLine("3003", 320, -24),
    ].join("\n"));
    const occupantId = model.instances[1].id, movingId = model.instances[2].id;
    const snap = snapConnection(model, occupantId, { x: 0, y: 1.2, z: 0 });
    expect(snap).not.toBeNull();
    model = { ...model, instances: model.instances.map(instance =>
      instance.id === occupantId ? { ...instance, matrix: snap!.matrix } : instance) };
    const occupied = activeConnections(model, occupantId);
    expect(occupied.length).toBeGreaterThan(0);

    const suggestions = previewConnections(model, movingId, { x: 0, y: 2.3, z: 0 });

    expect(suggestions.some(suggestion => occupied.some(contact =>
      contact.targetId === suggestion.targetId && contact.targetConnectorId === suggestion.targetConnectorId))).toBe(false);
  });

  it("omits contacts beyond the preview range", () => {
    const model = connectionFixture([
      partLine("3001", 0, -24),
      partLine("3003", 160, -24),
    ].join("\n"));
    expect(previewConnections(model, model.instances[1].id, { x: 0, y: 10, z: 0 })).toHaveLength(0);
  });
});
