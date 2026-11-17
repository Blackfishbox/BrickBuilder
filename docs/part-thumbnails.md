# Local LDraw thumbnails

The building library shows static previews of installed LDraw parts in the
current construction color. Part IDs, names, search and selection remain
available when a preview cannot be generated.

## Geometry and appearance

Inventory rows also reuse complete, previously acquired geometry snapshots
when no installed package contains the part. They update when a download
finishes or its cache is removed. Snapshot source hashes and provenance are
checked before compilation; previews never initiate a geometry download.

Previews read the selected installed package and its complete dependency
closure from IndexedDB. They do not require the full mapping catalog, contact
BrickLink, enable remote geometry access or download missing files. Missing
local geometry has an explicit unavailable state with details in its title.
Installing the appropriate package and reopening the library allows a retry.

Compilation uses the existing LDraw compiler and geometry preparation worker.
Rendering uses the editor's imported-scene materials, fixed geometry colors,
transparency and coordinate transform. Only inherited surfaces take the
selected color. Direct RGB colors are supported. Existing rendering limits,
including the lack of TEXMAP texture rendering, still apply.

## Mobile resource limits

- One visibility observer and one serial queue serve all visible rows.
- Leaving the viewport, changing color or closing the library cancels obsolete
  requests; late completions cannot replace the current color's image.
- One detached 160 × 120 WebGL canvas produces static PNG images. Rows contain
  images, not canvases or independent WebGL contexts.
- Image LRU: at most 128 entries and 4 MiB of string storage.
- Prepared-model LRU: at most 12 entries and 8 MiB of source/vertex buffers.
- Source cache: at most one installed package, capped at 8 MiB.
- A part's dependency closure is limited to 4 MiB of source text and 3,000 files.
  Larger or invalid geometries show an unavailable preview without preventing
  normal part selection.
- GPU meshes/materials are disposed after each image, and the shared renderer
  releases its context after 30 seconds without rendering.

Package revision, part identity, effective color/material and the active
mapping palette identity distinguish cached images. Offline reopening can
regenerate images from installed geometry; images themselves are not added to
the project or permanently stored.

## Verification

Focused automated checks cover queue serialization/deduplication, cancellation,
cache bounds, rapid color changes, stale-result suppression, failure without
blocking selection, local dependency resolution and fixed/transparent surfaces.
The existing library tests still cover categories, pagination and selection.
The production web build is also checked.

Mobile-sized browser captures inspect real bundled bricks, plates and curved
parts. These are browser evidence, not acceptance testing on a physical
Android smartphone. No emulator/screenshot GitHub workflow is added.
