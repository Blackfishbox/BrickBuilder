# Reviewed geometry additions

## Broader unofficial-library coverage

The bundled import geometry now includes a bounded, deliberately selected
Parts Tracker snapshot, not only the originally reported 5844. Exact added
part numbers, names, triangle counts, per-file authors/licenses/source URLs,
hashes, rejected roots and deferred roots are listed in the
[machine-readable review](../artifacts/brickbuilder-mobile/src/features/formats/unofficial-review.json).
The [bundle manifest](../artifacts/brickbuilder-mobile/src/features/formats/geometry-manifest.json)
is authoritative for shipped counts and the transport hash.

The 2026-11-14 expansion adds **2,154 roots**, bringing the bundled baseline to
**2,229 parts / 4,762 files**, at **3,143,641 compressed bytes**. Of the tracker
roots inspected within the per-file size limit, 4,536 were compatible with the
admission checks; 2,382 of those were deferred for bundle size. Another 753 were
already available in the approved official snapshot, 438 failed admission,
and two oversized archive files were not expanded. Existing bundled roots were
retained, rather than counted as new additions.

Admission requires:

- An explicitly accepted original license and author header for every file.
- All recursive dependencies, with no cycles and no more than 48 nested levels.
- Successful compilation with the application's actual geometry compiler,
  finite nonempty surfaces and at most 30,000 triangles per newly added root.
- No TEXMAP/image-data dependency: texture-dependent parts are excluded rather
  than claiming that their printed appearance is supported.

The expansion fills gaps in the approved official snapshot; valid existing
official files and previously bundled sources take precedence over tracker
revisions. All original file contents and attribution remain unchanged.
Unresolvable, incompatible and overly expensive roots are recorded, not silently
reported as supported. A valid LDraw geometry is not evidence of a confirmed
BrickLink part-number mapping, a snapping connector, or Studio feature parity.

The mobile baseline is limited to **3 MiB compressed** and **16 MiB of source
text**, including existing geometry. Low incremental dependency cost is used
to admit many roots while sharing primitives. Compatible roots outside this
budget are explicitly deferred; this is not a full Parts Tracker installation.
The limit avoids parsing the entire approximately 222 MB expanded tracker
archive for a single missing part on a phone.

The PWA precaches the hash-pinned bundle. Only the dependencies actually needed
by an imported model enter that model and its reusable IndexedDB geometry cache.
The native Android build receives the same static bundle when rebuilt; an
already installed APK does not update merely because source files changed.
No new paid service or live unofficial-source fallback is required.

### Deliberate maintenance

Inputs are the upstream [unofficial archive](https://library.ldraw.org/library/unofficial/ldrawunf.zip)
and a previously approved official directory made with
`scripts/prepare-ldraw-archive.py`. Their exact acquisition hashes and the
pre-expansion baseline hash are retained in the review. Downloaded archives and
expanded review inputs belong under ignored `generated-artifacts/`, not Git.
To reproduce the same selection, retain the matching baseline bundle as well
as those exact archive bytes; a newly downloaded tracker ZIP may have changed.

From the repository root:

```sh
cd scripts
LDRAW_REVIEW_BASELINE=../generated-artifacts/unofficial-baseline.bin \
  pnpm exec tsx ./review-unofficial-parts.ts \
  ../generated-artifacts/ldraw-unofficial-2026-11-14.zip \
  ../generated-artifacts/ldraw-approved
```

Without `--write`, the command only writes its report under generated outputs.
Review it before appending `--write`, which replaces the static bundle, its
manifest and the committed review. Leaving `LDRAW_REVIEW_BASELINE` unset uses
the current bundled geometry as the starting point for a new expansion.
The review script never runs during ordinary builds and does not silently
accept a changed official source file. Package counts and source URLs are not
an official LDraw approval or a visual inspection of every part.

## Part 5844

On 2026-11-14 the official LDraw endpoint did not contain `parts/5844.dat`.
The LDraw Parts Tracker's unofficial library supplied the actual geometry:

- Description: Arch 1 x 4 x 2.333 with Curved Top
- Author: Rene Rechthaler [Blechtaler]
- License: CC BY 4.0, retained verbatim in the file header
- Source: https://library.ldraw.org/library/unofficial/parts/5844.dat
- Reviewed SHA-256: `fff4b7dfa90dd38fef81efe381be295a7d8442f5c3b181c45b95495e5400b73d`

This is **unofficial LDraw geometry**, not an official-library certification or
a Studio-derived mesh. Do not relabel its provenance as official.

The bundled geometry snapshot includes its complete 19-file dependency closure.
Two missing official high-resolution primitives were added alongside the root:
`p/48/1-4cylo.dat` by Max Martin Richter [MMR1988] and
`p/48/1-4ndis.dat` by Franklin W. Cain [fwcain], both under CC BY 4.0.
Original source files, authors, licenses and URLs remain in the snapshot.
The existing `CAreadme.txt` and `CAlicense4.txt` documents are shipped with it.

To reproduce this deliberate maintenance step:

```sh
node scripts/reviewed-5844-snapshot.mjs
```

The script pins all three acquired source hashes and refuses changed bytes or
an incomplete dependency closure. It prints bundle metadata for manual review
and updating `geometry-manifest.json`; it does not run during ordinary builds.
An optional directory argument permits using already downloaded, pinned files.

Runtime API acquisition remains official-only. This change does **not** enable
automatic, unreviewed Parts Tracker downloads. Validated cached geometry keeps
its original official/unofficial source identity.

## Verification

Regression tests compile real 5844 geometry and validate offline cache reuse.
An optional local IO test uses `BRICKBUILDER_IO_REFERENCE` to verify all 20
occurrences in the reported private model without committing that model or its
geometry. It also checks that the original archive bytes remain unchanged.
