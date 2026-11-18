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

When instruction order/assignment is changed, the exporter writes an
instance-specific **flat assembly root** with standard LDraw `STEP`/`ROTSTEP`
boundaries. Original LDraw sections remain present as unreferenced source
records. IO additionally receives a regenerated `model.ins` using one step per
page. Titles and notes also use BrickBuilder LDraw comments so that the
application can recover them after reimport.

Superseded Studio `modelv2.ldr`, `model2.ldr` and `model.lxfml` files are moved to
`BrickBuilder/original/` instead of leaving stale active models in the archive.
A replaced `model.ins` is retained there too. These backups are not editable
features and do not automatically migrate to the flattened model.

If the source has inline primitive surfaces, rewriting its instruction
hierarchy is refused explicitly rather than silently dropping those surfaces.
Keep the original IO and the full JSON backup.

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
