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

Only explicit incoming LDraw mappings become selectable geometries. Multiple
LDraw references require a manual choice; absent mappings are shown but not
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

In the pinned catalog used during implementation, `cone` matches 165 source
records and 58 incoming LDraw mapping rows. Those figures are metadata coverage,
not a promise of 165 distinct buildable parts, current BrickLink availability,
prices, or successful rendering of all mapped geometries.
