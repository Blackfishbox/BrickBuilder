# Evidence-backed part colors

## Source, permission and snapshot

BrickBuilder includes a deliberately reviewed, offline snapshot of actual
Rebrickable element and official set/minifigure inventory observations,
**2026-11-16**, version `2026-11-16.2`. Each element or inventory-part row names
an exact Rebrickable part and color. Deduplicating these explicit pairs is
evidence; taking the Cartesian product of the separate parts/colors catalogs
would not be.

Sources: [public downloads](https://rebrickable.com/downloads/) and
[terms](https://rebrickable.com/terms/), reviewed 2026-11-16. Sections 5.1 and
5.3 permit catalog use in apps, including commercial apps, and identify the
public downloads as the bulk-access alternative to the API. Both pages were
fetched and checked again for this inventory extension, not inferred from the
earlier element review. The downloads page explicitly limits these exports
to official LEGO sets, parts and minifigures (no B-models, sub-sets or MOCs).
`inventories.set_num` refers to either `sets.set_num` or `minifigs.fig_num`.
Section 5.3 prohibits other automated site scraping and AI-model training;
neither is part of this maintenance process. This is a documented usage
review, not legal advice. Attribution:
**Catalog data sourced from Rebrickable and its community.** This is permission
under Rebrickable's terms, **not** a Creative Commons or geometry license.
No MOC data, site scraping, images, Studio resources, paid API or BrickLink
store data is used. No endorsement by Rebrickable, LEGO or BrickLink is implied.
The app's color picker includes the source, date, terms and limitations offline.

The source hashes, byte sizes, schemas and row counts are pinned in
[`color-evidence-manifest.json`](../artifacts/brickbuilder-mobile/src/features/catalog/color-evidence-manifest.json).
The compact gzip-in-`.bin` snapshot is **816,631 bytes**, SHA-256
`2ccc4a16c1672dcbf7a3621f1b1b1b0ae8ff449bea1b6ac1cd1d8fbb6ce3e2e0`.
Its payload schema **2** contains explicitly named `ldParts`, `ldColors`,
Rebrickable-keyed union `pairs`, and `pairsBySource` with independent
`elements`, `setInventories` and `minifigInventories` maps. A pair may have
multiple sources. The loader rejects a union inconsistent with those source
maps; it still reads frozen schema-1 element-only snapshots. The manifest's
own schema remains 1. This does not replace or change the older ID catalog.

Inventory evidence joins `inventory_parts.inventory_id` → `inventories.id`
→ an **exact** owner in `sets` or `minifigs`. Owner type is determined by
table membership, never a numeric or prefix heuristic. An absent inventory
or color, invalid quantity, duplicate inventory/owner, or changed CSV schema
fails generation. Rows with missing parts, unknown colors, or an inventory
without an official owner are excluded and counted. The manifest pins all
nine compressed/decoded source hashes, byte sizes, schemas and row counts.

All published inventory versions and positive-quantity spare rows count as
observations, not only the latest version or non-spares. Quantities do not
multiply distinct-pair counts. No part relationships, print/base fallback,
inventory set expansion, image URLs, or inferred component colors are used.
`inventory_minifigs` is not needed: minifigures' own part inventories are
already linked by `inventories` to the `minifigs` table.

## Meaning and conservative identity rules

- **Observed** means an exact pair occurs in a reviewed element or eligible
  official inventory-part row.
  It does not mean in stock, affordable, sold on BrickLink, currently made,
  or historically exhaustive. Absence means **not evidenced**, not impossible.
- Part resolution uses the explicit **LDraw import** direction in
  `part_mappings.csv`. A single exact Rebrickable candidate with observations
  constrains the palette. No candidate, no observations, or multiple
  Rebrickable candidates leave availability visibly unknown and the palette
  unrestricted. More observations do not resolve ambiguous identity.
- Printed/base IDs, assembly suffixes and subpaths are never stripped.
  Identity aliases not explicitly in this snapshot remain unknown, even if
  geometry resolution or the older BrickLink ID catalog knows them.
- Color translation uses **Rebrickable → LDraw export** mappings only when
  the reverse LDraw import identifies exactly that same Rebrickable color.
  Multiple outputs for the same RB color are valid. Unknown, ambiguous or
  output-only-without-reverse-evidence colors are counted but not guessed.
  LDraw inherited/edge colors 16/24 are not palette colors.
- Rebrickable, LDraw and BrickLink numbers are distinct namespaces. BrickLink
  identity is not required to show a known LDraw appearance. This snapshot
  claims Rebrickable observations, not independent BrickLink observations.
- Unknown-color sentinel -1 is excluded, not offered as a real color.
  One source element (`6121016`, part `21921pr0001`, RB color `19`) references
  a part absent from the contemporaneous parts table; it is explicitly excluded
  and recorded in the manifest. This exclusion is not silently counted as
  valid coverage.
- Inventory exclusions: **2 unknown-color rows**, **0 missing-part rows**,
  and **52 rows** belonging to inventory `242240` (owner `5008864-1`,
  version `1`), whose owner is absent from both official owner tables.
  Those 52 rows are not classified as official set/minifigure evidence.

## Offline behavior and editing

The static binary ships with Android and is explicitly precached by the PWA.
Android's preparation verifies its bytes and hash before synchronizing assets.
The final AAB check (`scripts/android/verify-default-bundle.py`) also requires
exactly one copy of the manifest-selected evidence asset inside
`base/assets/public/`, with its pinned size and SHA-256. Missing, duplicate,
truncated or changed assets fail the release check, even if preparation passed.
As with other PWA assets, a web installation must finish before first offline
use; the installed Android bundle needs no first-run network.

The existing catalog worker validates SHA-256, bounded decompression, schema
and mappings, then returns the index. The compressed snapshot is also stored
in the existing IndexedDB snapshot store, independently of the older catalog.
An offline cache hit makes no network request. A corrupt cached entry is
removed and a localized error offers retry. Until verified evidence is
available, the picker explicitly reports unknown availability and keeps the
free palette; there is no fabricated restriction.

Choosing a part does not change its current color. Colors already present in
the model, including direct colors or codes absent from the snapshot, remain
visible in a separate current-color section, rather than becoming selectable
as supposedly proven colors. Empty known-color intersections are not replaced
by an unrestricted palette.

“Mehrere Teile gemeinsam färben” opens the shared-color selection from desktop
or mobile. Additional selected model instances contribute the intersection of
their known color sets; unknown/ambiguous parts contribute no restriction.
An explicit color action updates the selected instances in one undoable edit.
Original import bytes, source text, geometry and mapping metadata remain
unchanged. Inventory placement and allocated instances retain their specified
colors; a mixed selection containing an allocated instance is locked as a
whole. The editor also enforces this protection against stale callbacks.

## Measured coverage

The complete union has **110,281 distinct observed pairs for 63,599
Rebrickable parts**, **21,145 additional pairs** beyond elements alone.
This is an observation count, not all-time color availability.

| Source | Parts | Distinct pairs | Pairs absent from elements |
| --- | ---: | ---: | ---: |
| Elements (unchanged baseline) | 47,883 | 89,136 | 0 |
| Official set inventories | 43,058 | 82,324 | 19,750 |
| Official minifigure inventories | 22,694 | 27,598 | 1,605 |

The two inventory gains overlap by **210 pairs**, so they must not simply
be added. There are **1,490,589 accepted set rows** and **83,029 accepted
minifigure rows** among **1,573,672 inventory-part rows**. The five original
element/mapping source hashes are identical to the previous approved snapshot.

Measured against the **312 exact selectable IDs** in the expanded default
library (including its retained compatibility reference):

| Status | Elements only | Combined |
| --- | ---: | ---: |
| Unique part mapping, observations and at least one displayable color | 279 (89.42%) | **293 (93.91%)** |
| Observations, but no safely displayable mapped colors | 0 | 0 |
| Ambiguous Rebrickable part mapping | 0 | 0 |
| Unique part mapping but no observations | 21 | 7 |
| No exact LDraw import mapping | 12 | 12 |

The incremental gain is **14 exact IDs / 4.49 percentage points**, all from
set inventories: `24308a`, `3023a`, `3068a`, `3069a`, `3070a`, `3096-f1`,
`36`, `3660d`, `3660e`, `4084b`, `422`, `911a`, `911b`, `u9651`.
Minifigure inventories add real pairs overall but **no additional covered
default-library IDs** beyond the element baseline in this snapshot.

Thus **19 IDs (6.09%) remain explicitly unknown**, without disabling those
parts. The seven mapped IDs without observations are `5787`, `7246`, `7435`,
`7523`, `7526`, `7880`, `7894`. The twelve unmapped IDs remain unchanged;
in particular `3023` does not borrow evidence from `3023a`.
See the generated, exact per-ID report
[`part-color-coverage.json`](../artifacts/brickbuilder-mobile/docs/part-color-coverage.json).
It retains the element-only baseline, combined results, separate incremental
source coverage, and an actual CSV row witness for every newly covered
part/color/source, including inventory ID, owner, version, quantity and spare
flag. CSV row numbers are one-based and include the header.
This denominator is library entries, not a claim that a compatibility alias
is a distinct physical part.

## Reproduction and approval

```sh
# Deliberate maintenance only; never invoked by Android, Vite or app startup.
python3 scripts/build-color-evidence.py \
  --directory generated-artifacts/color-evidence-sources \
  --version 2026-11-16.2 --snapshot-date 2026-11-16 --download
# Verify the downloaded hashes against the pinned manifest before approval.
# Re-run without --download to reproduce from the same frozen source bytes.
python3 scripts/build-color-evidence.py \
  --directory generated-artifacts/color-evidence-sources \
  --version 2026-11-16.2 --snapshot-date 2026-11-16 --approve
python3 -m unittest scripts/test_color_evidence.py
pnpm --filter @workspace/brickbuilder-mobile exec vitest run src/features/catalog
python3 -m unittest discover -s scripts/android -p 'test_*.py'
```

### Retired Android branch (historical)

The separate `android/google-play` source branch has been retired. Android and
web application changes now use `main`; do not cherry-pick updates into a
separate Android branch. Every push to `main` now starts the Play release
workflow. See [the Android and Google Play guide](android-google-play.md).

The Android-specific checks and preservation requirements described in older
transfer notes remain relevant to the native app, but the old branch-transfer
steps no longer apply. The inventory extension remains an already approved
snapshot; do not regenerate it as part of a build.

Upstream URLs are mutable; today's download is not a promise to reproduce an
older dated snapshot. Retain all nine frozen `.csv.gz` inputs outside Git
(the generated-artifacts directory is ignored by Git and deployment).
Only the compact approved runtime index, manifest and coverage report are
versioned; raw source files, image URLs and catalog names do not ship in the
runtime index. Generation also writes `manifest.json` and
`coverage-report.json` beside the inputs for review before `--approve`.
Review terms, schema, excluded records and coverage again before deliberately
approving another snapshot. Old unused approved binaries may be removed only
when no supported app manifest references them.
