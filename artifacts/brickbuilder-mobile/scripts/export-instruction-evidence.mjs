/**
 * Run through the workspace's existing tsx tool with this artifact's tsconfig.
 * Private inputs are opt-in command-line paths; outputs are always Git-ignored.
 * This prepares Studio acceptance files, not a Studio compatibility verdict.
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createEmptyDocument } from "../src/features/editor/model.ts";
import { parseLDraw } from "../src/features/formats/ldraw/parser.ts";
import { exportMPD } from "../src/features/formats/mpd/export.ts";
import { exportIO } from "../src/features/formats/io/export.ts";
import { readZip, writeZip } from "../src/features/formats/zip.ts";
import { sourceInstructionPlan, updateInstructions } from "../src/features/instructions/model.ts";

const workspace = fileURLToPath(new URL("../../../", import.meta.url));
const directory = resolve(workspace, "generated-artifacts/instruction-export-evidence");
mkdirSync(directory, { recursive: true });
const encode = text => new TextEncoder().encode(text);
const decode = bytes => new TextDecoder().decode(bytes);
const ref = (name, x = 0) => `1 16 ${x} 0 0 1 0 0 0 1 0 0 0 1 ${name}`;
const synthetic = `0 Synthetic instruction-export acceptance model
0 FILE main.ldr
0 !UNKNOWN preserved root record
1 4 0 0 0 1 0 0 0 1 0 0 0 1 assembly.ldr
0 STEP
0 BFC INVERTNEXT
1 2 100 0 0 -1 0.5 0 0 1 0 0 0 1 assembly.ldr
0 STEP
1 14 200 0 0 0 0 0 0 1 0 0 0 1 assembly.ldr
0 FILE assembly.ldr
0 BFC CERTIFY CCW
3 16 0 -24 0 20 -24 0 0 -24 20
${ref("3004.dat")}
0 STEP
0 BFC INVERTNEXT
${ref("3003.dat", 40)}
0 NOFILE
`;
const bundle = Object.create(null), records = [];
function prepare(stem, sourceText, originalBytes, options = {}) {
  const document = { ...createEmptyDocument(stem), imported: {
    version: 1, format: "io", sourceName: `${stem}.io`, originalBytes: Array.from(originalBytes),
    sourceText, ...parseLDraw(sourceText), resources: {}, legalDocuments: [],
  } };
  const ids = document.imported.instances.map(i => i.id);
  let intentionalLeafEdit = null;
  if (options.moveSingularLeaf) {
    const instance = document.imported.instances[4];
    instance.matrix = [1, 0, 0, 260, 0, 1, 0, -24, 0, 0, 1, 80];
    document.imported.edited = true;
    intentionalLeafEdit = { reference: instance.reference, color: instance.colorCode, worldMatrix: instance.matrix };
  }
  const plan = sourceInstructionPlan(document.imported);
  if (plan.steps.length > 512) {
    const size = Math.ceil(ids.length / 3);
    plan.steps = Array.from({ length: 3 }, (_, index) => ({
      id: `group-${index}`, title: `Group ${index + 1}`, notes: "",
      partIds: ids.slice(index * size, (index + 1) * size),
    }));
  }
  const steps = [...plan.steps].reverse().map((step, index) => ({
    ...step, title: `Exportprüfung ${index + 1}`,
    notes: options.moveSingularLeaf ? "Eine Teilposition verändert; Flächen unverändert." : "Schrittfolge geändert; Geometrie unverändert.",
  }));
  steps.splice(1, 0, { id: "acceptance-empty-step", title: "Bewusst leer", notes: "Kein zusätzliches Teil.", partIds: [] });
  const edited = updateInstructions(document, { ...plan, steps });
  const outputs = {
    [`${stem}-original.io`]: originalBytes,
    [`${stem}-edited.io`]: exportIO(edited),
    [`${stem}-edited.mpd`]: exportMPD(edited),
  };
  for (const [name, bytes] of Object.entries(outputs)) {
    writeFileSync(resolve(directory, name), bytes);
    bundle[name] = bytes;
  }
  const parsed = parseLDraw(decode(outputs[`${stem}-edited.mpd`]));
  records.push({
    model: stem, sourceParts: ids.length, exportedParts: parsed.instances.length,
    sourceSections: Object.keys(document.imported.sections).length,
    exportedSections: Object.keys(parsed.sections).length,
    steps: steps.map(step => ({ title: step.title, parts: step.partIds.length })),
    intentionalLeafEdit,
    files: Object.fromEntries(Object.entries(outputs).map(([name, bytes]) => [name, {
      bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"),
    }])),
  });
}
const syntheticArchive = writeZip({
  "model.ldr": encode(synthetic), "unknown.bin": new Uint8Array([0, 255, 17]),
});
prepare("synthetic-hierarchy-bfc", synthetic, syntheticArchive);
prepare("synthetic-singular-leaf-edit", synthetic, syntheticArchive, { moveSingularLeaf: true });
for (const path of process.argv.slice(2)) {
  const bytes = new Uint8Array(readFileSync(resolve(path)));
  const entries = readZip(bytes, { names: ["model.ldr"], studioEncryption: true });
  prepare(basename(path, ".io").replace(/[^a-z0-9_-]/gi, "_"), decode(entries["model.ldr"]), bytes);
}
const manifest = {
  generatedAt: new Date().toISOString(),
  studioOpening: { status: "not-performed", version: null, evidence: null },
  scope: "Preparation files and parser counts only. Run the automated regression suite separately.",
  records,
};
bundle["manifest.json"] = encode(`${JSON.stringify(manifest, null, 2)}\n`);
bundle["ACCEPTANCE.md"] = encode(`# Studio acceptance — NOT YET PERFORMED

These files are a test handoff, not proof of Studio compatibility.

1. Record the Studio version, operating system and the edited IO's SHA-256.
2. Open the original and edited IO as separate copies. Do not overwrite originals.
3. Compare the complete models: counts, positions, colors, repeated assemblies,
   the embedded triangles and BFC/reflections. Both synthetic models have six
   leaves, three inline triangles, one reflected/sheared assembly and one singular
   assembly. Only synthetic-singular-leaf-edit intentionally moves one 3004.dat
   occurrence to the world matrix in manifest.json; its ancestor's inline
   triangle must stay unchanged.
4. Open Instruction Maker. Compare titles, quantities and step order with
   manifest.json. Confirm the deliberately empty step and submodel behavior.
   Do not infer original page-layout compatibility from regenerated pages.
5. Save a new copy from Studio; retain screenshots of the model and instruction
   steps, any warnings, and the Studio-saved IO for an independent reimport.
6. Report each check as PASS, FAIL or NOT TESTED, including version and date.
   Keep private IOs and screenshots out of Git and public issue attachments.
`);
writeFileSync(resolve(directory, "manifest.json"), bundle["manifest.json"]);
writeFileSync(resolve(directory, "ACCEPTANCE.md"), bundle["ACCEPTANCE.md"]);
const zip = resolve(directory, "studio-acceptance.zip");
writeFileSync(zip, writeZip(bundle));
console.log(JSON.stringify({ directory, bundle: zip, studioOpening: manifest.studioOpening, models: records.map(r => ({
  model: r.model, parts: r.exportedParts, sections: r.exportedSections, steps: r.steps.length,
})) }, null, 2));
