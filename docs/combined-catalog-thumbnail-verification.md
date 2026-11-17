# Combined catalog and thumbnail verification

The catalog recovery, color-aware LDraw library previews and inventory-row
previews are integrated together in both `main` and `android/google-play`.
The branches intentionally retain their platform-specific differences.

## Combined checks

- Frontend TypeScript check passed.
- Catalog, parts and inventory regressions: 92 passed, 2 skipped.
- Production PWA build completed with its service worker.
- Android asset preparation completed and verified 312 selectable offline
  building entries.
- The native asset copy contains the approved 2,180,181-byte catalog at the
  manifest's `.bin` path, with SHA-256
  `ad5363fcd70e3d278cb26c69bb0af5291c89628ca84e6e674fccaa8ea6f5475c`.
- The native asset copy does not contain a PWA service worker.

The integration transfers only the inventory-preview component, its tests,
its shared thumbnail stylesheet import and the preview rendering inside each
inventory row. Existing catalog recovery and library-preview changes were
already present in both GitHub branches and were compared with the merged
workspace before transfer.

## Android safeguards

The Android inventory picker retains `importFileAccept('inventory')`; the
web branch's extension-based input filter must not overwrite it.
The native import helper, model picker, geometry request handling, application
ID, signing configuration, native insets, launcher icons, dependency lockfile
and release preparation scripts are preserved.

The existing push-triggered signed release workflow remains responsible for
the final AAB. It validates the packaged catalog, offline building assets,
privacy policy and R8 mapping. Downloads remain exclusively the signed AAB
and matching `mapping.txt`; no emulator or screenshot job is added and nothing
is published to Google Play automatically.

GitHub updates use existing public branch ancestry and normal fast-forward
pushes, not Replit checkpoint history or a full cross-branch snapshot.
Private uploads, signing material, personal fields and generated build output
are excluded. The workflow's live status must be checked separately; the local
checks above are not a claim of a finished signed build or physical-phone
acceptance.
