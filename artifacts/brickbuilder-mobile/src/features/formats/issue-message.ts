import type { MessageId } from "@/i18n/messages";
import type { ImportIssue } from "./types";

const issueMessages: Record<string, MessageId> = {
  "missing-part": "import.issue.missingPart",
  "geometry-invalid": "import.issue.invalidGeometry",
  "missing-bl-part": "import.issue.partMapping",
  "ambiguous-bl-part": "import.issue.ambiguousPartMapping",
  "missing-color": "import.issue.missingColor",
  "missing-bl-color": "import.issue.missingBricklinkColor",
  "ambiguous-bl-color": "import.issue.ambiguousBricklinkColor",
  "geometry-color": "import.issue.geometryColor",
  "geometry-cache": "import.issue.geometryCache",
  "geometry-download": "import.issue.geometryDownload",
  "geometry-cancelled": "import.issue.geometryCancelled",
  textures: "import.issue.textures",
  "io-scope": "import.issue.ioScope",
  "io-geometry-file-limit": "import.issue.ioGeometryFileLimit",
  "io-geometry-total-limit": "import.issue.ioGeometryTotalLimit",
  "io-instructions-limit": "import.issue.ioInstructionsLimit",
};

export function localizedImportIssue(
  issue: Pick<ImportIssue, "code" | "reference" | "count">,
  t: (id: MessageId, values?: Record<string, string | number>) => string,
  fallback?: string,
): string {
  const lineType = issue.code.startsWith("line-") ? issue.code.slice("line-".length) : undefined;
  const message = lineType ? "import.issue.lineType" : issueMessages[issue.code];
  if (!message) return fallback ?? "";
  return t(message, {
    reference: issue.reference ?? "",
    count: issue.count ?? 0,
    type: lineType ?? "",
  });
}
