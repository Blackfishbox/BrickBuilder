# Geometry snapshot for model import

The `public/parts/import-geometry-2026-10-31.bin` snapshot contains the original
74 official main parts, the separately reviewed unofficial part 5844, and a
bounded expansion of unofficial Parts Tracker roots with complete dependencies.
The historical transport filename is retained; its revision is the actual
SHA-256 in [the current manifest](../src/features/formats/geometry-manifest.json),
not the date in its filename. It is independent of the installable catalog
packages. No embedded Studio files are copied into it.

Source: <https://library.ldraw.org/library/updates/complete.zip>
(official library, retrieved 2026-10-31). Original file URLs, authors and
license information are included per file. Additional tracker sources retain
their real `https://library.ldraw.org/library/unofficial/` URLs, rather than
being labeled official. Legal documents from both origins are included;
CC0 legal code is included whenever a selected file uses it. See
[the expansion review](../../../docs/reviewed-geometry.md) for sources and scope.

Every file was checked for an explicit CC-BY-4.0, dual CC-BY-2.0-and-CC-BY-4.0,
or CC0 header and an LDraw-Org header. For dual headers, the offered CC-BY-4.0
license is used. Original headers, credits and history remain unchanged.
BrickBuilder changes: selection, gzip packaging and search metadata, not
original LDraw file content.

The current byte length, part/file counts and SHA-256 are recorded in the manifest
linked above. The app checks both hash and byte length on download.
The `.bin` extension is intentional: gzip is the internal package format,
not HTTP Content-Encoding. Automatic HTTP decompression would change the
checksum of bytes read by `fetch`.
The snapshot is deliberately generated, never automatically updated during
app builds. The explicit maintenance script accepts a locally downloaded
official archive via `LDRAW_ARCHIVE` to avoid many individual requests.

Geometry, authors and legal documents remain in the local project after import,
including JSON backups. LDR/MPD/minimal IO export references library files
without embedding geometry copies. The user's file is read only as a private
reference and is not included in the public snapshot or build.

Color names and RGB values are an explicit subset of LDConfig.ldr.
Separate BrickLink color numbers are documented in the color resolver with
source links and review date. Number equality is never inferred.

This documents a technical provenance/license review, not legal advice.
