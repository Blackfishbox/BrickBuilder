# Evidence-backed part colors

## Source, permission and snapshot

BrickBuilder includes a deliberately reviewed, offline snapshot of actual
Rebrickable `elements.csv.gz` observations, **2026-11-16**, version
`2026-11-16.1`. Each row names an element, a Rebrickable part and a Rebrickable
color. Deduplicating these explicit pairs is evidence; taking the Cartesian
product of the separate parts/colors catalogs would not be.

Sources: [public downloads](https://rebrickable.com/downloads/) and
[terms](https://rebrickable.com/terms/), reviewed 2026-11-16. Sections 5.1 and
5.3 permit catalog use in apps, including commercial apps, and identify the
public downloads as the bulk-access alternative to the API. Attribution:
**Catalog data sourced from Rebrickable and its community.** This is permission
under Rebrickable's terms, **not** a Creative Commons or geometry license.
No MOC data, site scraping, images, Studio resources, paid API or BrickLink
store data is used. No endorsement by Rebrickable, LEGO or BrickLink is implied.
The app's color picker includes the source, date, terms and limitations offline.

The source hashes, byte sizes, schemas and row counts are pinned in
[`color-evidence-manifest.json`](../artifacts/brickbuilder-mobile/src/features/catalog/color-evidence-manifest.json).
The compact gzip-in-`.bin` snapshot is **286,661 bytes**, SHA-256
`dc044211d89d4a137b35adfb2f16a55b8f600a8cca592a7fc0a1dfb4916903ed`.
Its versioned schema contains explicitly named `ldParts`, `ldColors` and
Rebrickable-keyed `pairs`. It does not replace or change the older ID catalog.

## Meaning and conservative identity rules

- **Observed** means an exact pair occurs in the reviewed element export.
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

## Offline behavior and editing

The static binary ships with Android and is explicitly precached by the PWA.
Android's preparation verifies its bytes and hash before synchronizing assets.
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

The complete evidence snapshot has **89,136 distinct observed pairs for
47,883 Rebrickable parts**. This is an element-export observation count, not
all-time color availability.

Measured against the **312 exact selectable IDs** in the expanded default
library (including its retained compatibility reference):

| Status | IDs |
| --- | ---: |
| Unique part mapping, observed pairs and at least one displayable color | **279 (89.42%)** |
| Observed pairs, but no safely displayable mapped colors | 0 |
| Ambiguous Rebrickable part mapping | 0 |
| Unique part mapping but no element observations | 21 |
| No exact LDraw import mapping | 12 |

Thus **33 IDs (10.58%) remain explicitly unknown**, without disabling those
parts. See the generated, exact per-ID report
[`part-color-coverage.json`](../artifacts/brickbuilder-mobile/docs/part-color-coverage.json).
This denominator is library entries, not a claim that a compatibility alias
is a distinct physical part.

## Reproduction and approval

```sh
# Deliberate maintenance only; never invoked by Android, Vite or app startup.
python3 scripts/build-color-evidence.py \
  --directory generated-artifacts/color-evidence-sources \
  --version 2026-11-16.1 --snapshot-date 2026-11-16 --download
# Verify the downloaded hashes against the pinned manifest before approval.
# Re-run without --download to reproduce from the same frozen source bytes.
python3 scripts/build-color-evidence.py \
  --directory generated-artifacts/color-evidence-sources \
  --version 2026-11-16.1 --snapshot-date 2026-11-16 --approve
python3 -m unittest scripts/test_color_evidence.py
pnpm --filter @workspace/brickbuilder-mobile exec vitest run src/features/catalog
```

Upstream URLs are mutable; today's download is not a promise to reproduce an
older dated snapshot. Retain all five frozen `.csv.gz` inputs outside Git
(the generated-artifacts directory is ignored by Git and deployment).
Only the compact approved runtime index, manifest and coverage report ship.
Review terms, schema, excluded records and coverage again before deliberately
approving another snapshot. Old unused approved binaries may be removed only
when no supported app manifest references them.
