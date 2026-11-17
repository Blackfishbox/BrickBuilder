# Building search beyond installed parts

The building drawer searches the local packages first. With at least two
characters it also searches the pinned catalog in the existing background
worker. The Android catalog is bundled, so metadata search does not require a
live BrickLink connection or a geometry download. The web app may need to
acquire the verified catalog once; local results remain usable if that fails.

The global list is paginated in groups of 40 rather than stopping at the
older inspector's 60-result limit. Searches match names and source identifiers,
including BrickLink and LDraw identifiers. Dimensions such as `1x1`, `1 x 1`
and `1×1` are normalized. The existing category filters use the same English
name prefixes as the curated category packages; without a filter, all matching
catalog records, including minifigure patterns and unmapped records, remain
discoverable.

Only records with explicit incoming, path-safe LDraw mappings are shown in building
search. Filtering happens before pagination and counts. Multiple
LDraw references require a manual choice; absent mappings are hidden and never
guessed from similar Rebrickable or BrickLink numbers. Source identities stay
separately labelled. Parts unavailable in the installed packages use the
existing preparation/import path, which checks local geometry and resolves
missing files on selection or for visible search previews, subject to the existing Android download
consent. An unavailable or unsupported source remains an error, not claimed
compatibility.

Catalog previews first use installed or already cached geometry. Visible rows
with an explicit LDraw choice also acquire missing geometry through the existing
validated resolver, one part at a time, with a 30-second per-part deadline.
Scrolling away or changing the query cancels obsolete work. Android's existing
online-geometry consent still applies; disabling it never triggers requests.
Downloaded dependency closures are stored in IndexedDB for offline previews and
building. Colors are rendered locally, so changing color does not download another
geometry. Failures show an explicit retry control; records without a usable
LDraw mapping cannot have a trustworthy generated preview.

Inventory-list previews remain local-only. Search does not install the entire
library or silently expand project inventory quantities. Building from this general catalog is unrestricted, as
with the existing free LDraw tab; inventory-list quantities apply only to parts
placed from the inventory tab.

In the pinned catalog, `cone` matches 165 source records, of which 57 have
usable incoming LDraw identities (58 mapping rows). Building search shows those
57 records; the separate mapping inspector still includes all metadata.
Mappings do not guarantee current source availability or successful rendering.
Network/permission errors remain visible with retry rather than hiding otherwise
valid parts. Placement errors appear beside the clicked result; preview errors
are readable text, not only hover tooltips.
Background preview acquisition pauses while a part is explicitly being prepared
for building, cancelling queued preview work instead of competing with that action.

The real `3942a` file and its recursive closure can be checked through the
operator's pinned archive API with the optional integration test:

```sh
BRICKBUILDER_REPRO_API=https://brickbuilder.blackfishbox.de/api \
  pnpm --filter @workspace/brickbuilder-mobile exec vitest run \
  src/features/formats/catalog-source-repro.test.ts
```

This is an explicit network check, skipped in ordinary offline test runs.
Package, catalog, connection and license information follows the building search
and all its result pages instead of preceding them.
