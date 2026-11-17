/** Only incoming, path-safe LDraw identities may become building references. */
export function usableLDrawId(mapping: readonly string[]): string | undefined {
  if (mapping[1] !== "LD" || mapping[4] !== "True") return undefined;
  const id = mapping[2]?.toLowerCase().replace(/\.dat$/i, "");
  return id && /^[a-z0-9_-]+$/.test(id) ? id : undefined;
}

export function incomingLDrawIds(row: { mappings: readonly string[][] }): string[] {
  return [...new Set(row.mappings.map(usableLDrawId).filter((id): id is string => Boolean(id)))];
}
