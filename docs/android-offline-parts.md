# Android offline parts distribution

The default building library contains **369 distinct selectable entries**:
the original 12 building entries and 357 physical parts from the existing,
license-reviewed import snapshot. This is not the complete LDraw catalog.

The 2026-11-17 distribution includes every eligible physical root in the six
existing groups: bricks, plates/baseplates, tiles, slopes/wedges, Technic and
vehicle/details. It adds 57 parts without changing existing source geometry,
catalog mappings or color evidence.

The six category packages total 820,127 compressed bytes and 5,087,778 bytes
of expanded JSON, compared with 690,957 and 4,278,091 respectively in the
previous distribution. These JSON sizes are not peak JavaScript heap usage or
total Android installation sizes. Each package remains independently usable,
including its dependency closure and original legal documents.
Earlier public package versions remain available for older clients; therefore
the new version adds approximately 0.8 MB to copied Android assets, rather
than only the approximately 129 KB increase in active compressed payload.

## Why not install the entire catalog by default?

- The editor currently reads all installed library files during geometry
  resolution. Installing a complete catalog would increase parsing, IndexedDB
  duplication and transient memory pressure even for small models.
- The number of source files is not the number of physical building parts:
  primitives, subparts, aliases, decorated variants and other building systems
  must not inflate selectable coverage.
- Every redistributed file and recursive dependency needs a compatible,
  checked license and unchanged credits. A newly downloaded complete archive
  is not automatically an approved application bundle.
- Having geometry does not establish BrickLink identity, observed colors or
  verified magnetic connections. Unsupported metadata must stay explicit.

A much larger optional offline installation should first resolve dependencies
on demand, search indexed part metadata and install bounded packages. It should
be evaluated on actual lower-memory Android hardware before becoming the
default. The current increase does not download new upstream snapshots or
change the existing geometry-download consent.

## Reproduction and verification

Run `python3 scripts/build-default-parts.py` explicitly to reproduce the pinned
packages. The generator verifies original author/license headers and complete
dependency closures. It does not fetch live upstream files.

The default-library regression installs all packages with asset-only fetches,
checks 369 unique IDs, compiles every root, saves/reopens representative
placements and tests update/rollback protection. Native release checks verify
that every package declared by the manifest is copied with the expected bytes
and SHA-256. See
`artifacts/brickbuilder-mobile/docs/default-parts-coverage.json` for exact
category counts and IDs.

The color-evidence snapshot is unchanged. Its dated coverage report describes
the library at that snapshot's generation time; it is not a claim that all 369
current entries have confirmed colors or BrickLink mappings.
