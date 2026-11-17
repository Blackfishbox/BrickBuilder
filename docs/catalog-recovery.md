# Catalog transport and inventory recovery

## Root cause

The approved compressed catalog is unchanged: version `2026-11-01.1`,
2,180,181 bytes, SHA-256
`ad5363fcd70e3d278cb26c69bb0af5291c89628ca84e6e674fccaa8ea6f5475c`.
The original bytes were recovered from an existing verified Android build
input and independently matched the API download and previously packaged AAB.
No replacement source, new mapping inference or live data update was needed.
The original source checksums and licensing attribution remain in both manifests.

The old URL ended in a digest without a filename extension. Capacitor 8's
`WebViewLocalServer.handleLocalRequest` deliberately sends `index.html` for
extensionless HTML5 routes, before reading the corresponding asset. Thus the
correct catalog could be present in the AAB while `fetch().arrayBuffer()`
received HTML. Retrying that same path could never repair it.

The new canonical URL ends in `/catalog.bin`. The API retains its old endpoint
for older web clients and existing build-input URLs. Native packaging uses the
same manifest URL and refuses extensionless catalog paths. The final AAB check
now verifies the mapping catalog's actual packaged path, byte count and digest,
not only the building packages and color evidence.

## HTTP representation

The checked development API response at the new URL was HTTP 200 with
`Content-Type: application/octet-stream`, `Content-Length: 2180181`,
`Cache-Control: public, max-age=31536000, immutable, no-transform`,
no `Content-Encoding`, and the exact pinned SHA-256.
This distinguishes the Android HTML fallback from a missing object, stale
manifest or transparent HTTP decompression. Do not mark the binary's internal
gzip format as HTTP `Content-Encoding: gzip`: fetch transparently decodes that
representation and would deliver different bytes to validation.

Static installations must place the snapshot at the manifest's `.bin` path,
not rewrite missing binary URLs to the SPA. The installer migrates the old
extensionless on-disk catalog as an input when upgrading. Source downloads and
build outputs remain outside Git.

## Recovery boundaries

- Validate cached length, digest, decoded schema, complete source row counts,
  mapping flags and catalog version before accepting the index.
- If the pinned IndexedDB catalog record is invalid, delete only that record,
  then try one fresh download in the same operation.
- Fresh downloads and explicit retries use `cache: no-store`. Failed or
  malformed responses are never persisted; do not loop indefinitely.
- HTML, decoded JSON, missing assets and wrong lengths have distinct actionable
  messages. Same-length corruption still fails worker SHA-256 validation.
- Projects, inventory quantities/allocations, saved mapping evidence and the
  separate color-evidence snapshot are not cleared.
- Inventory imports can retry the same selected file without requiring a new
  file-picker selection. Replacement remains explicit and previewed.

## Focused checks

```sh
pnpm --filter @workspace/brickbuilder-mobile exec vitest run \
  src/features/catalog src/features/inventory
python3 -m unittest discover -s scripts/android -p 'test_*.py'
python3 -m unittest scripts/test_self_host.py
python3 scripts/android/verify-default-bundle.py /path/to/app-release.aab
```

Place the approved input in `generated-artifacts/android-inputs/catalog.bin`
to enable the full catalog integration tests (the signed-release CI downloads
it before tests). These execute the real client, worker handler and IndexedDB
with a synthetic XML inventory: duplicate 3001/red rows merge to quantity 5,
3002/yellow retains quantity 4, and the correct LDraw IDs/colors survive a
database close/reopen with networking disabled. They also exercise corrupt
cached bytes, failed recovery, preservation of the saved inventory and
independent evidence, and a subsequent successful retry.

This is not a physical-device acceptance claim. Normal release automation
still produces only a signed AAB and matching R8 `mapping.txt`; no emulator,
screenshot workflow, signing-key change or Play publishing is involved.
