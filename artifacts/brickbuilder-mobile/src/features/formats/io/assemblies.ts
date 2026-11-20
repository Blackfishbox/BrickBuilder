import { referenceLine } from "../ldraw/parser";
import { normalizePath, normalizeReference } from "@workspace/ldraw-source";
import type { ProjectGeometryFile } from "../types";

export const IO_GEOMETRY_LIMITS = {
  perFileBytes: 8 * 1024 * 1024,
  totalBytes: 32 * 1024 * 1024,
  instructionsBytes: 8 * 1024 * 1024,
} as const;

export type IOSkipReason =
  | "io-geometry-file-limit"
  | "io-geometry-total-limit"
  | "io-instructions-limit";

/** Decide what to retain before ZIP entries are decompressed into memory. */
export function createIOEntrySkipPolicy(): (name: string, size: number) => IOSkipReason | undefined {
  let geometryBytes = 0;
  return (name, size) => {
    if (/^CustomParts\/.+\.dat$/i.test(name)) {
      if (size > IO_GEOMETRY_LIMITS.perFileBytes) return "io-geometry-file-limit";
      if (geometryBytes + size > IO_GEOMETRY_LIMITS.totalBytes) return "io-geometry-total-limit";
      geometryBytes += size;
    } else if (/^model\.ins$/i.test(name) && size > IO_GEOMETRY_LIMITS.instructionsBytes) {
      return "io-instructions-limit";
    }
    return undefined;
  };
}

/**
 * Studio can encode a whole MOC as CustomBrick assemblies in CustomParts/.
 * Expand only explicit assemblies made entirely from type-1 references:
 * primitive meshes must never be mistaken for individual catalog bricks.
 * The contents stay project-owned; nothing is installed in the public library.
 */
export function readIOAssemblies(entries: Record<string, Uint8Array>): Record<string, string[]> {
  const sections: Record<string, string[]> = Object.create(null);
  for (const [path, bytes] of Object.entries(entries)) {
    if (!/^CustomParts\/[^/]+\.dat$/i.test(path)) continue;
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/^\uFEFF/, "");
    if (!/^\s*0\s+CustomBrick\s*$/mi.test(text)) continue;
    const lines = text.split(/\r?\n/);
    // Multiple FILE sections require a separate namespace-aware import path.
    if (lines.filter(line => /^0\s+FILE\s/i.test(line)).length > 1) continue;
    const content = lines.filter(line => !/^0\s+(?:FILE\s|NOFILE\s*$)/i.test(line));
    if (content.some(line => line.trim() && !/^(?:0(?:\s|$)|1\s)/.test(line.trim()))) continue;
    const references = content.filter(line => /^\s*1\s/.test(line));
    if (!references.length) continue;
    for (const line of references) referenceLine(line);
    const name = path.slice("CustomParts/".length).toLowerCase();
    if (!/^[a-z0-9_ .-]+\.dat$/.test(name)) throw new Error("Unsicherer Baugruppenname im IO-Archiv.");
    sections[name] = content;
  }
  return sections;
}

export function includeIOAssemblies(bytes: Uint8Array, sections: Record<string, string[]>): Uint8Array {
  if (!Object.keys(sections).length) return bytes;
  const source = new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/^\uFEFF/, "");
  const defined = new Set([...source.matchAll(/^0\s+FILE\s+(.+)$/gmi)].map(match => match[1].trim().toLowerCase().replaceAll("\\", "/")));
  const used = new Map<string, string[]>();
  const pending = [source.split(/\r?\n/)];
  while (pending.length) for (const line of pending.pop()!) {
    if (!/^\s*1\s/.test(line)) continue;
    const name = referenceLine(line).reference.toLowerCase();
    if (defined.has(name) || used.has(name) || !Object.hasOwn(sections, name)) continue;
    used.set(name, sections[name]); pending.push(sections[name]);
  }
  if (!used.size) return bytes;
  // Keep the original root references/colors, not model2.ldr's display colors.
  // Make the effective source self-contained so later edited MPD exports can
  // reconstruct the very same occurrence paths. Original IO bytes stay intact.
  const base = /^0\s+FILE\s/im.test(source) ? source : `0 FILE model.ldr\n${source}\n0 NOFILE`;
  return new TextEncoder().encode(`${base}\n${[...used]
    .map(([name, lines]) => `0 FILE ${name}\n${lines.join("\n")}\n0 NOFILE`).join("\n")}\n`);
}

/** Preserve supplied meshes without asserting a redistribution license. */
export function readIOGeometry(
  entries: Record<string, Uint8Array>,
  assemblies: Record<string, string[]>,
  onSkipped?: (archivePath: string, reason: IOSkipReason) => void,
): Record<string, ProjectGeometryFile> {
  const files: Record<string, ProjectGeometryFile> = Object.create(null);
  let totalBytes = 0;
  for (const [archivePath, bytes] of Object.entries(entries)) {
    if (!/^CustomParts\/.+\.dat$/i.test(archivePath)) continue;
    const suppliedName = archivePath.slice("CustomParts/".length).toLowerCase();
    if (Object.hasOwn(assemblies, suppliedName)) continue;
    const relative = normalizeReference(suppliedName);
    const content = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    // Studio sometimes writes s/foo.dat into CustomParts/s/s/foo.dat.
    // Collapse only that duplicated transport directory when the FILE header
    // explicitly confirms the canonical identity; never trust arbitrary aliases.
    const declared = content.replace(/^\uFEFF/, "").match(/^0\s+FILE\s+(.+)$/mi)?.[1].trim().replaceAll("\\", "/").toLowerCase();
    const canonical = declared?.startsWith("s/") && relative === `s/${declared}` ? normalizeReference(declared) : relative;
    const path = normalizePath(canonical.startsWith("p/") || canonical.startsWith("parts/") ? canonical : `parts/${canonical}`);
    if (content.includes("\0")) throw new Error(`Eingebettete Geometrie ungültig: ${archivePath}`);
    if (content.length > IO_GEOMETRY_LIMITS.perFileBytes) {
      onSkipped?.(archivePath, "io-geometry-file-limit");
      continue;
    }
    if (totalBytes + content.length > IO_GEOMETRY_LIMITS.totalBytes) {
      onSkipped?.(archivePath, "io-geometry-total-limit");
      continue;
    }
    if (files[path]) throw new Error(`Doppelte eingebettete Geometrie: ${path}`);
    totalBytes += content.length;
    files[path] = {
      path, content, license: "Project-source", sourceArchivePath: archivePath,
      sourceUrl: `urn:brickbuilder:io:${encodeURIComponent(archivePath)}`,
      author: content.match(/^\s*0\s+Author:\s*(.+)$/mi)?.[1].trim() || "Autor in der Projektdatei nicht angegeben",
    };
  }
  return files;
}
