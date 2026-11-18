# Default offline building parts

The default library contains **312 selectable entries: 311 physical parts and
one retained compatibility reference** (`3023`, explicitly moved by LDraw to
`3023b`). The expansion adds **300 distinct physical top-level parts**, without
counting that reference, primitives, subparts, shortcuts, flexible sections,
patterned variants or duplicated dependency files.

## Pinned coverage

| New independent package | Physical parts | Official roots | Reviewed unofficial roots | Bundled bytes |
| --- | ---: | ---: | ---: | ---: |
| Bricks | 36 | 17 | 19 | 102,198 |
| Plates and baseplates | 49 | 29 | 20 | 86,494 |
| Tiles | 33 | 27 | 6 | 48,480 |
| Slopes, wedges, wings, arches and cones | 62 | 41 | 21 | 122,897 |
| Technic, bars, hinges and brackets | 51 | 30 | 21 | 129,092 |
| Vehicle and building details | 69 | 49 | 20 | 201,796 |
| **Added** | **300** | **193** | **107** | **690,957** |

The original six bricks and six plate references remain unchanged, including
their package IDs, geometry, attribution and hashes. Their 11 physical roots
are excluded from the new selection, as is the `3023b` target of the retained
compatibility reference.

The **compressed geometry asset increase is exactly 690,957 bytes**
(674.76 KiB). The six new JSON payloads expand to **4,278,091 UTF-8 bytes**
including metadata/legal documents and repeated dependencies. IndexedDB needs
additional browser-specific indexing/string overhead; this is not a promise
of an exact on-device database size. No second copy of the full import archive
is created. Search metadata and this report add a small separate amount.

Exact IDs, per-package counts and expanded payload sizes:
[`default-parts-coverage.json`](../artifacts/brickbuilder-mobile/docs/default-parts-coverage.json).

## Sources and reproducibility

`python3 scripts/build-default-parts.py` reproduces the versioned packages from
the already reviewed, bundled `import-geometry-2026-10-31.bin`, pinned to SHA-256
`32911d11322d15d1db02dac54aab541a3c8def0ef11de1152a2313520c5894cf`.
It makes **no network requests** and is not an automatic build-time update.
Eligible physical part files already used as dependencies may also become
selectable roots. Official roots are selected first, then already-reviewed
unofficial roots are distributed across useful categories. This is a bounded
selection, not a complete LDraw library or a popularity-ranked catalog.

Every package contains its complete recursive dependency closure, original
source bytes as UTF-8 text, author credits, original license headers, source
URLs and official/unofficial legal documents. The generator verifies
per-file source, author, accepted license and dependency closure. The app
checks the compressed transport's byte length/SHA-256, then schema, legal
documents, dependencies and per-file content hashes before a transaction
changes that package. `.bin` avoids HTTP's automatic `.gz` decompression
changing the bytes used for integrity verification.

The new files are CC BY 4.0, including original dual-licensed headers where
present. Attribution and changes are in the package catalog and in each
package's file records. Retain both sets of original legal documents.
Geometry availability does not assert BrickLink identity, available colors
or physically validated connector support. No catalog mapping is inferred.

## Initialization, updates and performance

Opening the local parts library automatically initializes all bundled packages.
No install button, internet permission, API or online geometry opt-in is
required. Android serves these files from its installed assets even on its
first offline launch. PWA builds precache all eight packages with their pinned
hashes; like other PWAs, the web application must first finish installing its
service worker/assets before a completely disconnected visit can work.

Source packages are installed sequentially. Initialization only decodes and
persists package text/metadata, never compiles meshes. Search reads only the
312 metadata rows; it does not decode the 2,229-root import archive. The UI
renders 40 results at a time with an explicit load-more control. Geometry is
compiled for selected parts when preparing placement.

Initialization is shared between concurrent calls, skips current packages and
does not downgrade separately installed newer versions. It only replaces
the package being installed in one transaction. Other packages, projects,
active project IDs and inventory quantities are not cleared. A failure is
reported and can be retried; completed packages are reused. Existing project
resources retain resolver precedence, followed by installed resources, cache
and the import snapshot. Previously approved package files are retained when
constructing new dependency closures.

## Verification

- All 312 selectable references resolve and compile to nonempty finite meshes
  with online resolution disabled and only bundled asset requests allowed.
- One part from each new category is prepared, placed, saved to IndexedDB and
  reopened; initialization after reopening requires no package fetch.
- Regression coverage checks independent package validation, concurrent
  initialization, source preservation, old project/package retention, retries,
  corrupt/truncated downloads, interrupted installs and quota rollback.
- Production PWA builds include all eight packages in the precache.
- Android preparation verifies every bundled package in generated assets
  before Capacitor sync; release verification also checks the signed bundle's
  packaged bytes against the catalog.

These automated checks are not a physical Android device/WebView performance
or GPU acceptance test. Before store submission, exercise first-run offline
selection, placement, save/reopen, low storage and app upgrades on target phones.

### Verified signed Android build

The [successful Android build](https://github.com/Blackfishbox/BrickBuilder-Mobile/actions/runs/43933802833)
produced signed version code **22**, version name **0.1.0**, from the current
Android release history with its native-inset and document-picker fixes intact.
Both Android 15/API 35 and Android 16/API 36 native checks passed.

The downloaded AAB was independently checked with `jarsigner -verify`.
All eight bundled package byte lengths and hashes match the catalog, with
312 selectable entries and no bundled PWA worker. The separately downloaded
R8 mapping is byte-identical to the mapping embedded in the signed AAB.

| Output | Bytes | SHA-256 |
| --- | ---: | --- |
| `app-release.aab` | 14,412,920 | `e6ec6a1d0997b91fb1115593599eb18f1f37b6e3d7af3d41328a5de2bdd96d5f` |
| `mapping.txt` | 6,939,971 | `d02c0ca307a645ccf0e6e609720b26cffbbbfebb74c81c657533b43600eae044` |

The signed build was generated for manual distribution/testing; nothing was
uploaded to Google Play or published to production.
