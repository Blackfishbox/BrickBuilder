import flatPinPlate from "./fixtures/3023a.dat?raw";
import type { ImportedModel } from "../formats/types";

/** First-party supplement, not a modification of the upstream shadow snapshot.
 * Source guards intentionally reject custom meshes sharing a catalog number.
 * The flat pin occupies X [-4,4], Z [-1.5,1.5]. Both X +/-10 openings
 * admit a radius-6 stud through Y [4,8], as checked against source triangles.
 * Full source/attribution and review boundaries are in fixtures/README.md.
 */
export function reviewedStandardMeta(path: string, model?: ImportedModel): { text: string; sha256: string } | undefined {
  if (path === "parts/5844.dat" && model) {
    const file = model.resources[path];
    // The pinned Shadow Library has no entry for this unofficial part. This
    // metadata is reviewed against its exact credited LDraw source revision;
    // changed or Studio-authored replacements deliberately fail closed.
    if (file?.sha256 !== "fff4b7dfa90dd38fef81efe381be295a7d8442f5c3b181c45b95495e5400b73d" ||
      file.author !== "Rene Rechthaler [Blechtaler]" || file.license !== "CC-BY-4.0") return;
    return {
      text: [
        "0 !LDCAD SNAP_CYL [gender=F] [caps=one] [secs=S 6 4] [pos=0 56 -60]",
        "0 !LDCAD SNAP_CYL [gender=F] [caps=one] [secs=S 6 4] [pos=0 56 0]",
      ].join("\n"),
      sha256: file.sha256,
    };
  }
  if (path !== "parts/3023a.dat" || !model) return;
  const content = model.resources[path]?.content;
  if (content?.replace(/\r\n/g, "\n").trimEnd() !== flatPinPlate.trimEnd()) return;
  return {
    text: "0 !LDCAD SNAP_CYL [gender=F] [caps=one] [secs=S 6 4] [pos=0 8 0] [grid=C 2 1 20 0]",
    sha256: "f49389ea0cffbc83346724fea5a1718a7e8a2c3d8d664736f8aab75233516659",
  };
}
