import type { BuilderDocument } from "../editor/model";
import { normalizeSizeGuideReference, sizeGuidePart, sizeGuideProjection } from "./size-guide-geometry";

/** Only actual axle titles, not "axle hole", connectors, gears or axle pins. */
const axleTitle = /^(?:technic\s*,?\s*)?(?:(?:cross|flexible)\s+)?axle(?:\s+flexible)?\s+(\d+(?:[.,]\d+)?)(?=\s|$|L\b)/i;
const axleFamily = /^(?:(?:technic|train|wheel|metal)\s*,?\s*)?(?:(?:cross|flexible)\s+)?axle\b(?!\s+(?:hole|connector|pin|joiner)\b)/i;
const connectorFamily = /\b(?:connector|joiner|coupling|hub|holder)\b|\baxle\s+(?:(?:and|&)\s+)?(?:pin|hole)\b/i;

export function instructionAxle(document: BuilderDocument, reference: string) {
  const instance = sizeGuidePart(document, reference);
  if (!instance) return undefined;
  const number = normalizeSizeGuideReference(reference);
  const resources = document.imported?.resources;
  const file = resources?.[`parts/${number}.dat`] ?? resources?.[`${number}.dat`];
  // The approved/project-local source header is independent of catalog mappings.
  const title = file?.content.split(/\r?\n/, 1)[0].replace(/^0\s+[~=]?/, "").trim();
  const names = [title, instance.part.name, ...(instance.part.mapping?.status === "confirmed"
    ? instance.part.mapping.candidates.map(candidate => candidate.name) : [])];
  // A source description of a connector/joiner is authoritative: a catalog's
  // different wording must not reclassify it as a measurable axle. In particular
  // "Axle and Pin Connector" is not an axle whose bounding extent is its length.
  if (names.some(name => name && connectorFamily.test(name))) return undefined;
  for (const name of names) {
    const match = name?.match(axleTitle);
    if (match) {
      const length = Number(match[1].replace(",", "."));
      if (Number.isFinite(length) && length > 0) return { name: name!, length: `${length}L`, number };
    }
    if (name?.match(axleFamily)) {
      // E.g. train/metal axles have no Technic nominal L length. Never infer
      // one from their overall extent or from a diameter in the title.
      let length: string | undefined;
      try {
        const projection = sizeGuideProjection(document, reference);
        if (projection) length = `${Number(projection.width.toFixed(3))} mm`;
      } catch { /* Retain the real name/identifier when geometry is unavailable. */ }
      return { name, length, number };
    }
  }
  return undefined;
}
