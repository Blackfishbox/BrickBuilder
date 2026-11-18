# Studio IO import and archive limits

An IO file is a ZIP container. Its number of entries is not its physical part
count: colliders, connectivity data, thumbnails, primitives and subparts can
produce hundreds of entries even for a small compressed upload.

## Embedded assemblies and geometry

BrickBuilder keeps `model.ldr` as the source of root transforms and colors.
It does not replace that source with `model2.ldr`, whose display colors can
differ. Explicit `CustomBrick` files under `CustomParts/` that contain only
comments and part references are expanded as editable assemblies. Their leaf
occurrences can be selected, moved, recolored and removed individually.

Supplied `.dat` meshes and recursive subparts/primitives can also be rendered
locally. Studio sometimes duplicates the subpart directory as
`CustomParts/s/s/name.dat`; BrickBuilder uses `parts/s/name.dat` only when the
file's own `FILE` header confirms that identity.

Uploaded geometry is marked **Project-source**, not CC0 or CC BY by inference.
It stays in the project and its JSON backup. It is never installed into the
shared part library or included in reusable geometry-cache closures, including
when a public-looking part depends on private geometry. Public LDraw packages
continue to use their separately checked credits and licenses.

The exact original IO bytes remain stored. An untouched IO export returns
those bytes. After model edits, the exporter preserves additional archive
resources and updates the effective model; see also
[instruction export boundaries](building-instructions.md).
LDR/MPD exports do not promise a self-contained copy of arbitrary private meshes.
Use IO or JSON when those supplied meshes must accompany the model.

## Current safety budgets

| Check | Limit |
| --- | ---: |
| Compressed source upload | 32 MiB |
| ZIP entries | 4,096, previously 128 |
| Total declared uncompressed archive size | 256 MiB, previously 32 MiB |
| One selected decompressed entry | 32 MiB, previously 16 MiB |
| All selected decompressed entries | 64 MiB |
| Embedded mesh source per file | 4 MiB |
| Project geometry source total | 24 MiB |
| Effective model source | 16 MiB |
| Expanded model occurrences | 10,000 |
| Model/geometry hierarchy depth | 48 levels |

Import reads only the model, instruction data and embedded `.dat` files;
unused images, colliders and alternate models stay compressed in the original.
ZIP64, split archives, unsafe/duplicate paths, overlapping payloads, mismatched
headers, invalid checksums, cyclic references and invalid coordinates are
still rejected. Decompression uses prevalidated fixed output budgets rather
than trusting a DEFLATE stream's claimed output.

These are deliberate memory and corruption protections for phones, not file
format licensing restrictions. Removing all limits would expose the app to
decompression bombs and out-of-memory crashes. An absent catalog mapping does
not by itself make an uploaded mesh unusable.

## Verification

The IO regression suite covers large entry counts, selective decoding, bounded
allocations, inherited colors and transforms, subpart identity, private-cache
isolation, JSON remapping and edited MPD/IO round trips. A private uploaded
template with 382 archive entries is tested locally as 356 renderable leaf
occurrences without internet geometry downloads. That user file is not shipped
in this repository; the private test skips when it is unavailable.
