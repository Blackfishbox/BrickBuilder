/** Observations, never claims about stock or physically impossible colors. */
export const evidenceSources = ["elements", "setInventories", "minifigInventories"] as const;
export type EvidenceSource = typeof evidenceSources[number];
type ObservedPairs = Record<string, string[]>;
export interface ColorEvidenceData {
  schema: 1 | 2;
  version: string;
  snapshotDate: string;
  ldParts: [string, string][];
  ldColors: [string, string, string, string][];
  pairs: ObservedPairs;
  pairsBySource?: Record<EvidenceSource, ObservedPairs>;
}
export interface ColorEvidenceIndex {
  version: string;
  snapshotDate: string;
  parts: Record<string, string[]>;
  colors: Record<string, string[]>;
  pairs: ObservedPairs;
  pairsBySource: Record<EvidenceSource, ObservedPairs>;
}
const key = (id: string) => id.toLowerCase().replace(/\.dat$/i, "");
const own = <T>(record: Record<string, T>, id: string): T | undefined =>
  Object.hasOwn(record, id) ? record[id] : undefined;

export function indexColorEvidence(data: ColorEvidenceData): ColorEvidenceIndex {
  if (![1, 2].includes(data.schema) || !data.version || !/^\d{4}-\d{2}-\d{2}$/.test(data.snapshotDate) ||
      !Array.isArray(data.ldParts) || !Array.isArray(data.ldColors) ||
      !data.pairs || Array.isArray(data.pairs) || typeof data.pairs !== "object") {
    throw new Error("Ungültiges Farbnachweisformat.");
  }
  const parts: Record<string, string[]> = Object.create(null);
  const imports = new Map<string, Set<string>>();
  for (const row of data.ldParts) {
    if (row.length !== 2 || row.some(v => typeof v !== "string" || !v)) throw new Error("Ungültiger Teilenachweis.");
    const [ld, rb] = row;
    (parts[key(ld)] ??= []).push(rb);
  }
  for (const row of data.ldColors) {
    if (row.length !== 4 || row.some(v => typeof v !== "string") ||
        !/^\d+$/.test(row[0]) || !/^\d+$/.test(row[1]) ||
        row.slice(2).some(v => !["True", "False"].includes(v))) throw new Error("Ungültiger Farbnachweis.");
    if (row[3] === "True") {
      const ids = imports.get(row[0]) ?? new Set<string>();
      ids.add(row[1]); imports.set(row[0], ids);
    }
  }
  const colors: Record<string, string[]> = Object.create(null);
  for (const [ld, rb, output] of data.ldColors) {
    // RB -> LD export, and the reverse LD import must identify only this RB color.
    if (output === "True" && imports.get(ld)?.size === 1 && imports.get(ld)?.has(rb) && !["16", "24"].includes(ld)) {
      const values = colors[rb] ??= [];
      if (!values.includes(ld)) values.push(ld);
    }
  }
  const validatePairs = (pairs: ObservedPairs) => {
    if (!pairs || typeof pairs !== "object" || Array.isArray(pairs)) throw new Error("Ungültige Farbnachweisquelle.");
    for (const [rb, values] of Object.entries(pairs)) {
      if (!rb || !Array.isArray(values) || !values.length || new Set(values).size !== values.length ||
          values.some(v => typeof v !== "string" || !/^\d+$/.test(v))) {
        throw new Error("Ungültige Teil-Farb-Kombination.");
      }
    }
  };
  validatePairs(data.pairs);
  // Old frozen snapshots remain readable; new ones must prove every union pair.
  const pairsBySource = data.schema === 1
    ? { elements: data.pairs, setInventories: {}, minifigInventories: {} }
    : data.pairsBySource;
  if (!pairsBySource || Object.keys(pairsBySource).length !== evidenceSources.length ||
      evidenceSources.some(source => !Object.hasOwn(pairsBySource, source))) {
    throw new Error("Fehlende Farbnachweisquellen.");
  }
  const union = new Map<string, Set<string>>();
  for (const source of evidenceSources) {
    validatePairs(pairsBySource[source]);
    for (const [part, colors] of Object.entries(pairsBySource[source])) {
      const combined = union.get(part) ?? new Set<string>();
      colors.forEach(color => combined.add(color));
      union.set(part, combined);
    }
  }
  if (union.size !== Object.keys(data.pairs).length || Object.entries(data.pairs).some(([part, colors]) =>
    union.get(part)?.size !== colors.length || colors.some(color => !union.get(part)?.has(color)))) {
    throw new Error("Widersprüchliche Herkunft der Farbnachweise.");
  }
  for (const id of Object.keys(parts)) parts[id] = [...new Set(parts[id])];
  return { version: data.version, snapshotDate: data.snapshotDate, parts, colors, pairs: data.pairs, pairsBySource };
}

export type PartColorEvidence =
  | { status: "known"; rebrickableId: string; codes: string[]; unmappedColors: string[] }
  | { status: "unknown" | "ambiguous"; candidates: string[] };
export function partColorEvidence(reference: string, index?: ColorEvidenceIndex): PartColorEvidence {
  const ids = index ? own(index.parts, key(reference)) ?? [] : [];
  if (ids.length !== 1) return { status: ids.length > 1 ? "ambiguous" : "unknown", candidates: ids };
  const pairs = own(index!.pairs, ids[0]);
  if (!pairs?.length) return { status: "unknown", candidates: ids };
  return { status: "known", rebrickableId: ids[0],
    codes: [...new Set(pairs.flatMap(rb => own(index!.colors, rb) ?? []))],
    unmappedColors: pairs.filter(rb => !own(index!.colors, rb)?.length) };
}

/** Unknown/ambiguous parts add no restriction. Known constraints intersect. */
export function selectionColorEvidence(references: string[], index?: ColorEvidenceIndex) {
  const evidence = [...new Set(references.map(key))].map(id => partColorEvidence(id, index));
  const known = evidence.filter(e => e.status === "known");
  const codes = known.length ? known.reduce((common, part) =>
    common.filter(code => part.codes.includes(code)), known[0].codes) : undefined;
  return { codes, known: known.length,
    unknown: evidence.filter(e => e.status === "unknown").length,
    ambiguous: evidence.filter(e => e.status === "ambiguous").length,
    unmappedColors: known.reduce((sum, e) => sum + e.unmappedColors.length, 0) };
}

export interface EvidenceSwatch { name: string; value: string; ldrawCode: string }
/** Keep existing/imported colors visible, but don't offer them as proven replacements. */
export function evidencePalette(palette: EvidenceSwatch[], codes: string[] | undefined, current: EvidenceSwatch[]) {
  const visible = palette.filter(c => codes === undefined || codes.includes(c.ldrawCode));
  const preserved = current.filter((c, i) => !visible.some(v => v.ldrawCode === c.ldrawCode) &&
    current.findIndex(v => v.ldrawCode === c.ldrawCode) === i);
  return { visible, preserved };
}
