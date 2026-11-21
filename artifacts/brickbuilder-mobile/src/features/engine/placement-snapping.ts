import type { PreparedPart } from "../editor/ldraw-editing";
import type { ImportedModel } from "../formats/types";

export const PLACEMENT_SNAP_ID = "placement-snap";

/** Keep one immutable connection index throughout a placement gesture. */
export function placementSnapModel(original: ImportedModel | undefined, prepared: PreparedPart): ImportedModel {
  const resources = { ...prepared.model.resources, ...original?.resources };
  const source = prepared.model.instances[0];
  const matrix = [...source.matrix] as typeof source.matrix;
  matrix[3] = 0;
  matrix[7] = prepared.bottom * 20;
  matrix[11] = 0;
  return {
    ...(original ?? prepared.model),
    resources,
    instances: [...(original?.instances ?? []), { ...source, id: PLACEMENT_SNAP_ID, matrix }],
  };
}
