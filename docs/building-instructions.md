# Building instructions

Open the project menu and choose **Bauanleitung bearbeiten / PDF**.
All processing and PDF generation take place locally, including on Android.
No model or instruction image is uploaded to a PDF service.

## Supported workflow

- IO, LDR and MPD imports read `STEP` and numeric `ROTSTEP` boundaries.
- Every physical occurrence has its own assignment, including repeated
  submodels and identical part numbers.
- The viewer shows the cumulative assembly up to the selected step.
- Add, delete and reorder steps; edit their titles and notes; move one or
  multiple parts between steps. Deleting a step moves its parts to a neighbor.
- Changes participate in the editor's local history and autosave. Close the
  instruction panel to use the ordinary Undo/Redo controls.
- Deleted model parts disappear from instruction assignments. Newly added parts
  are placed in the final step until explicitly reassigned.
- Per-step XYZ rotations are shown immediately in the interactive 3D preview,
  as well as in the PDF and generated IO instruction data. Step changes and
  resetting rotation refresh the view without changing any part transforms.
  The touch camera remains usable in addition to the stored step orientation;
  the non-WebGL compatibility view also supports camera roll.
- A parts box above the live model shows the **new parts for the selected step**:
  canonical shape previews in their actual colors, quantities and part numbers.
  Swipe the box horizontally when there are many different parts. Geometry is
  read from the project, including embedded IO resources, without network access
  or installing private files in a shared library. Missing previews are labeled.
  Preview jobs are serialized through one shared thumbnail renderer, with a
  software fallback. The global image cache is bounded to 4 MiB/128 images.
- The PDF includes the same illustrated box above each construction image.
  Overflow groups receive continuation pages; full textual identifiers and color
  names remain available. Thumbnails use complete source triangles, with the
  same explicit per-render software budget rather than sampled or invented shapes.
- Internal JSON backups include the editable instruction plan and original
  model archive. Instance IDs are remapped together with assignments on import.

## PDF

The export creates a genuine A4 PDF with an assembly image for every step,
titles, notes and a quantity/color parts list. Long text and lists continue on
additional pages. Each assembly view uses actual loaded geometry and a stable
whole-model framing; it is not a decorative placeholder.

A single bounded WebGL renderer and instanced geometry are reused across pages,
then disposed. If WebGL cannot start, a local 2D software renderer uses the
actual triangles without sampling, up to a strict limit of 120,000 triangles.
Larger models explicitly require WebGL instead of silently losing surfaces.
Progress and cancellation are available. Sufficient device memory is required;
very large PDFs can still exceed a phone's memory. Missing geometry is disclosed on the relevant pages, while
the parts list remains complete. The exporter does not download missing parts.
On Android, the ordinary local share/save sheet handles the resulting PDF.

## IO and MPD export boundaries

An entirely untouched IO import is returned byte-for-byte. For ordinary model
edits the occurrence-aware MPD exporter retains its source hierarchy and step
markers. Unknown archive resources remain in the exported IO.

### Source Studio layout editing

Imported `model.ins` data now has a separate **Studio-Seitenlayout** editor.
Page selection is independent of the cumulative construction-step preview.
It displays source template names and zero-based Studio step indices, without
guessing page-to-part membership when the indices are ambiguous.

Supported edits are deliberately limited to fields observed in local examples:

- Page locking and each existing step's four `RectOffset` values.
- Existing slot images: rectangle, rotation, opacity and horizontal/vertical
  reflection. The supplied rotation-arrow decoration is an embedded image,
  not a native Studio arrow object.
- Existing global callout colors, borders, padding, spacing, divider settings
  and arrow color/thickness. These are style defaults, not placed callouts.

These are raw Studio attribute values; rectangle units and rendering semantics
have not been established by reopening the edited files in Studio. Local
PNG/JPEG image thumbnails identify the object being edited; the editor is not
a composited page preview. Values are checked when leaving a field or pressing
Enter. Invalid values are reported and not saved. Per-field reset, reset-all,
local layout undo, ordinary project history and JSON backup are available.

Layout-only IO export patches the requested attribute spans in the original
XML instead of rebuilding it. Comments, CDATA, unknown elements/attributes,
`GlobalSetting`, `Pages`, `ContentItems` and `CustomLayouts` are retained.
All other archive entries, including image resources and active native model
variants, keep their exact decompressed bytes. The original `model.ins` is also
retained under `BrickBuilder/original/`; the ZIP container itself is recompressed.
Layout-only MPD export leaves the original construction sequence unchanged.

Combining layout patches with model changes or construction-step edits is
explicitly refused for IO export, rather than silently discarding the layout
or assigning native page references to the wrong steps. Save a JSON project
to keep both, or reset the layout patches before exporting the changed steps.
This restriction does not change the existing construction export path below.

**Not implemented:** creating/deleting/reordering Studio pages, changing custom
templates, creating native arrows or placed callouts, or editing unknown
content-item schemas. No source example with a placed native callout has been
provided. Native callout creation must not be inferred from global style XML.
The PDF exporter remains a separate simple step document and does not reproduce
these source-page edits.

When instruction order/assignment is changed, the occurrence-aware MPD exporter
partitions the active hierarchy into the requested root `STEP`/`ROTSTEP` sequence.
Only the selected occurrences enter each step's submodel variants. Shared
definitions are not globally reordered, and identical variants can be reused.
Nested local transforms, effective colors and BFC state remain in their original
frames. An edited leaf that cannot be represented under a singular/unsafe parent
is lifted into its assigned root step with its world matrix and inherited BFC
inversion. Unedited leaves under singular parents need no inverse.

Inline type-2/3/4/5 geometry remains active **once per original occurrence**.
Because those primitives have no editable part IDs, they follow the earliest
surviving descendant's assigned step. Geometry-only submodels follow their
parent's geometry owner; without surviving descendants they use that owner (the
final step at root). They are not deleted along with catalog parts. Explicit
empty steps, titles, notes and rotations survive BrickBuilder reimport. A
BrickBuilder root marker distinguishes these explicit boundaries from ordinary
source-subassembly construction steps.

Original LDraw sections remain as source records; the active root has a
collision-safe name. Unknown metadata is preserved, not semantically rewritten
for third-party extensions. IO additionally receives a regenerated `model.ins`
using one step per page. This is not proof of Studio's interpretation of those
pages or nested subassembly steps.

Superseded Studio `modelv2.ldr`, `model2.ldr` and `model.lxfml` files are moved to
`BrickBuilder/original/` instead of leaving stale active models in the archive.
A replaced `model.ldr` and `model.ins` are retained there too; an existing backup
is never overwritten. Other archive entries keep their decompressed bytes.
These backups are not active editable features and their native page indices do
not automatically migrate to the changed construction sequence.

The existing 1,024-section and 16-MiB MPD budgets still apply. Splitting many
occurrences across thousands of steps can exceed them; export then fails
explicitly, leaving the source archive and JSON backup untouched. No geometry is
silently dropped and safety limits are not raised to make an export pass.

Studio's proprietary page designer, placed callouts, buffer exchanges, native
arrows and camera-target/zoom controls are **not fully supported**.
Where source step counts match, numeric model rotations are read from Studio's
XML. A mismatch produces a warning, not guessed page-to-part assignments.
Original layout data remains archived, but regenerated construction-step
instructions do not retain its original appearance. The attribute-only path
above avoids that regeneration when no construction edits are combined with it.

## Verification scope

Automated tests cover occurrence-specific assignment, empty steps, live-model
reconciliation, JSON ID remapping, PDF generation/cancellation and IO/MPD
reimport. The locally supplied shield and vehicle IO files verify source
archive preservation and effective part counts after instruction export.
Private models are not committed or used as public fixtures.
See the separate [hierarchical export evidence](instruction-export-evidence.md)
for executed checks and the still-blocked actual-Studio acceptance.

Hierarchical-export regressions additionally compare effective world-space leaf
multisets, complete reachable type-2/3/4/5 geometry, BFC winding/clipping/inversion,
repeated occurrences, singular transforms, geometry-only sections, repeated
exports, deliberate empty steps and original archive members. Private checks
cover the shield, vehicle, 40649 and raised-base source IOs. The 8,590-leaf 40649
source resolves to 4,340 source steps: its geometry roundtrip uses three explicit
construction groups followed by reordering, **not** a successful reversal of
all 4,340 steps (that exceeds the unchanged section budget).

#### Reproducible Studio acceptance handoff

Generate synthetic IO/MPD files, hashes, expected counts and a manual checklist:

```sh
pnpm --filter @workspace/scripts exec tsx \
  --tsconfig ../artifacts/brickbuilder-mobile/tsconfig.json \
  ../artifacts/brickbuilder-mobile/scripts/export-instruction-evidence.mjs
```

Optional trailing arguments are paths to private IOs (relative to `scripts/`,
or absolute). They are opt-in and never fetched. All outputs, including
`studio-acceptance.zip`, go under the ignored
`generated-artifacts/instruction-export-evidence/` directory. The manifest marks
Studio opening **not performed**; generating the bundle does not change that.
Record actual Studio version, file hash, model/step checks, screenshots, warnings
and a Studio-saved copy separately. Both synthetic models have six leaf parts,
three embedded triangles, repeated, reflected/sheared and singular assemblies.
The second model intentionally moves one leaf out of its singular parent; the
manifest records that expected world matrix.

Source-layout tests also cover exact attribute-only XML changes, unknown
content/CDATA/comment preservation, archive resource equality, unchanged MPD
hierarchy for layout-only edits, JSON persistence, validation and rejection of
unsafe combined edits. The newly uploaded examples are byte-identical to the
earlier shield and vehicle examples; their custom-layout definitions are empty.

### Accepted scope and outstanding compatibility checks

The user accepted closing this work with the limited source-attribute editor
described above because no further suitable reference examples were available.
This does not mean the original full Studio-page editing request is implemented.
Placed-callout editing and native arrow creation remain unimplemented. A real
Studio reopen has **not** been performed in this environment, and parser reimport
is not a substitute.

Before claiming native compatibility, open an exported copy in an identified
Studio version, inspect the edited image's transform and global style settings,
verify all pages/resources and model counts, save it in Studio, and reimport that
saved copy. Record results without committing private IO files, images or XML.

These tests do **not** prove that all Studio releases open regenerated IO
layouts, or that the generated pages reproduce Studio's page designer.
Actual Studio reopening and physical Android-device testing remain separate
compatibility checks.
