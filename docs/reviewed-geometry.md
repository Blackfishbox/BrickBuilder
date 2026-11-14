# Reviewed geometry additions

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
