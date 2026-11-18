# Hierarchical instruction export: evidence

Checked on 2026-11-18. This document distinguishes parser/algorithm evidence
from an actual Studio-open/save result.

| Evidence | Result | Scope |
| --- | --- | --- |
| Synthetic regressions | Passed | Occurrence-specific steps; repeated/nested assemblies; all primitive types; BFC winding, clipping and inversion; reflections/shear; singular-parent lifting; geometry-only branches; empty steps; rotations/notes; added/deleted leaves; reexport and archive backups |
| Private shield IO | Passed | 57 effective leaves; reordered source steps; effective matrices/colors, geometry/BFC and archive-member bytes |
| Private vehicle IO | Passed | 429 effective leaves; reordered source steps; effective matrices/colors, geometry/BFC and archive-member bytes |
| Private 40649 IO | Passed within stated scope | 8,590 effective leaves in three reassigned groups, then reordered; effective matrices/colors, geometry/BFC and archive-member bytes |
| Private raised-base IO | Passed | Two effective leaf references; source geometry/BFC and archive-member bytes; this count is not a Studio metadata part-count assertion |
| Actual Studio opening | **NOT PERFORMED / BLOCKED** | Studio is not installed in the Linux workspace. No Studio version, screenshots or Studio-saved copy are available. |

The 40649 source resolves to 4,340 construction steps. Reversing all of those
steps requires more than the existing 1,024-section budget and is explicitly
refused. The successful three-group case must not be reported as proof of a
successful full reversal. The original upload and JSON source remain unchanged
on rejection; the limit is not bypassed.

## Commands and results

- `pnpm --filter @workspace/brickbuilder-mobile run test`:
  **932 passed, 10 skipped**, across 66 passing and two skipped test files.
  The four local private instruction fixtures above were present and executed.
  Optional external/live tests are not substituted for local fixture evidence.
- `pnpm --filter @workspace/brickbuilder-mobile run typecheck`: passed.
- `PORT=4173 BASE_PATH=/ pnpm --filter @workspace/brickbuilder-mobile run build`:
  passed, with existing third-party annotation and bundle-size warnings.
- `git diff --check`: passed.

The independent geometry traversal in
`artifacts/brickbuilder-mobile/src/features/formats/mpd/export.test.ts`
checks reachable primitives and BFC separately from `parseLDraw`'s leaf counts.
Private archives are compared with byte-buffer comparisons, not millions of
individual assertion entries. Untouched IO remains byte-identical; edited
archives preserve original model and instruction sources plus superseded Studio
variants under `BrickBuilder/original/`.

## Remaining acceptance

Generate the handoff using the command in
[building instructions](building-instructions.md#reproducible-studio-acceptance-handoff).
Its ignored `studio-acceptance.zip` contains original and edited IOs, edited
MPDs, SHA-256 hashes, expected step/part counts and `ACCEPTANCE.md`.
Private inputs are included only when explicitly passed to the generator.

Before closing the actual-Studio requirement:

1. Record Studio version, OS, date and the edited IO's hash.
2. Open original and edited copies; compare counts, effective appearance,
   submodels, inline surfaces, colors and reflections/BFC. Record warnings.
3. Inspect Instruction Maker against the manifest, including the deliberately
   empty step, ordering and per-step quantities. Parser roundtrips alone do not
   establish Studio's nested-submodel step semantics or page-index behavior.
4. Save a new IO from Studio and supply it for reimport, together with
   screenshots and explicit PASS/FAIL/NOT TESTED results.

Do not commit private models, their geometry, screenshots or extracted XML.
Do not claim lossless native page-layout compatibility from these checks.
