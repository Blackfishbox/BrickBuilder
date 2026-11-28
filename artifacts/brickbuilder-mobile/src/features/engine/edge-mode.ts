export type EdgeMode = "off" | "thin" | "thick";

export function nextEdgeMode(mode: EdgeMode): EdgeMode {
  if (mode === "off") return "thin";
  if (mode === "thin") return "thick";
  return "off";
}

export function readEdgeModePreference(value: string | null): EdgeMode {
  if (value === "thick" || value === "true") return "thick";
  if (value === "thin") return "thin";
  return "off";
}
