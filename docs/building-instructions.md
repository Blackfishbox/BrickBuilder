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
- Per-step rotation settings are used in the PDF and generated IO instruction
  data. The interactive construction preview has its own touch camera.
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

Studio's proprietary page designer, callouts, buffer exchanges, arrows,
page decorations and camera-target/zoom controls are **not fully supported**.
Where source step counts match, numeric model rotations are read from Studio's
XML. A mismatch produces a warning, not guessed page-to-part assignments.
Original layout data remains archived, but changed instructions do not retain
its original appearance.

## Verification scope

Automated tests cover occurrence-specific assignment, empty steps, live-model
reconciliation, JSON ID remapping, PDF generation/cancellation and IO/MPD
reimport. The locally supplied shield and vehicle IO files verify source
archive preservation and effective part counts after instruction export.
Private models are not committed or used as public fixtures.

These tests do **not** prove that all Studio releases open regenerated IO
layouts, or that the generated pages reproduce Studio's page designer.
Actual Studio reopening and physical Android-device testing remain separate
compatibility checks.
