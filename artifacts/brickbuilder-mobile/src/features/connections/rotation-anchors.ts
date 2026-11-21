import { describeConnections } from "./description";
import { shadowRecords } from "./dataset";
import type { ImportedModel } from "../formats/types";
import type { Family } from "./types";

export interface RotationAnchor {
  id: string;
  position: [number, number, number];
  family: Family;
  evidencePath: string;
  evidenceLine: number;
}

/**
 * Shadow Library connector frames describe explicit connection locations,
 * not a universal pivot. Expose only distinct positions backed by that source.
 */
export function rotationAnchors(reference: string, model?: ImportedModel): RotationAnchor[] {
  const shadow = shadowRecords();
  const byPosition = new Map<string, RotationAnchor>();
  for (const connector of describeConnections(reference, model).connectors) {
    if (!Object.hasOwn(shadow, connector.evidence.path)) continue;
    const position: [number, number, number] = [
      connector.frame[3], connector.frame[7], connector.frame[11],
    ];
    if (!position.every(Number.isFinite) || position.every(value => Math.abs(value) < 1e-8)) continue;
    const key = position.map(value => Math.round(value * 1000) / 1000).join(",");
    if (!byPosition.has(key)) {
      byPosition.set(key, {
        id: key, position, family: connector.family,
        evidencePath: connector.evidence.path, evidenceLine: connector.evidence.line,
      });
    }
  }
  return [...byPosition.values()].sort((a, b) =>
    a.position[1] - b.position[1] || a.position[0] - b.position[0] ||
    a.position[2] - b.position[2] || a.family.localeCompare(b.family));
}
