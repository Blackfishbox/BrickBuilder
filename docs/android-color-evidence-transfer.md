# Android color-evidence transfer

> Historical transfer record. The separate `android/google-play` branch has
> since been retired. `main` is now the only Android source, and Play releases
> start automatically on pushes to `main`; use [the current release guide](android-google-play.md).

## Branch boundary

The Android transfer started at
`4f530ec95a21d8624e36cc4f237c716bf3c47c1f`, the verified
`android/google-play` remote tip. It did not merge `main` into Android.
The resulting Android source is
[`062f0b6615b0e0c5f05fd6097a5374d2a561eae1`](https://github.com/Blackfishbox/BrickBuilder-Mobile/commit/062f0b6615b0e0c5f05fd6097a5374d2a561eae1).

Only the two already merged shared changes were cherry-picked:

- `8aa7a38f7b063515e036b10621e03e01e5081432`: evidence loader, worker,
  picker, editor guards, attribution, tests and frozen element observations.
- `dd0b1800a7edfc713ee30594d6ca9b06b6b9baed`: reviewed official
  set/minifigure observations and corresponding tests/report.

The final archive verifier and its regression tests were then transferred,
and Android CI was extended to run the color-evidence, picker, construction
and inventory tests. No source downloads or evidence regeneration occurred.
The pre-existing catalog-repair and unknown-mapping work was not included.

The following Android-only paths remained byte-for-byte unchanged from the
starting Android revision:

- Native Android project, including insets, app identity, icons and signing.
- `src/platform/` and `src/features/formats/` in the mobile app, including the
  document-provider import picker and opt-in geometry requests.
- `scripts/android/prepare.mjs`, `release-privacy.mjs` and `viewport.mjs`.
- `.github/workflows/android-native-insets.yml` and `pnpm-lock.yaml`.

The existing signed-release workflow was retained; only its regression-test
commands were expanded. Builds still inject private controller details into
generated assets only. Nothing publishes to the Play Store.

## Verification

Executed on the Android tree:

```sh
python3 -m unittest scripts/test_color_evidence.py
python3 -m unittest discover -s scripts/android -p 'test_*.py'
node --test scripts/android/*.test.mjs
pnpm run typecheck:libs
pnpm --filter @workspace/brickbuilder-mobile typecheck
pnpm --filter @workspace/brickbuilder-mobile exec vitest run \
  src/platform src/features/privacy src/features/parts src/features/catalog \
  src/features/editor/catalog-construction.test.tsx \
  src/features/inventory/builder-inventory.test.tsx \
  src/features/engine/camera-gesture.test.ts \
  src/features/connections/standard-plates.test.ts
# With ANDROID_CATALOG_PATH pointing to the existing reviewed catalog.bin:
pnpm --filter @workspace/brickbuilder-mobile android:prepare
```

Results: 211 Vitest tests passed, two existing tests skipped; type checks
passed; six Android preparation tests passed; seven archive checks passed;
four generator fixture tests passed. Complete raw-source reproduction was
skipped because the frozen upstream downloads were not present. Regenerating
or downloading replacement upstream data was intentionally outside this work.

The approved evidence file was independently checked in source public assets,
Vite output and Capacitor's synchronized Android assets: **816,631 bytes**,
SHA-256
`2ccc4a16c1672dcbf7a3621f1b1b1b0ae8ff449bea1b6ac1cd1d8fbb6ce3e2e0`.
The offline building-package check confirmed **312 selectable entries**.
The picker tests distinguish observed, unknown and ambiguous identities,
mixed selections and fixed inventory colors. The frozen-data tests explicitly
distinguish known `3023a` from unknown `3023`, without borrowing variant data.

The signed build and both native-inset jobs **passed**. Results are available in the
[Android release run](https://github.com/Blackfishbox/BrickBuilder-Mobile/actions/runs/43991280346).
Its final AAB verifier checks the evidence bytes inside the actual package,
not merely the pre-sync directory. It confirmed the exact evidence SHA-256
above, all 312 selectable entries and the absence of a PWA service worker.
Signature verification, the R8 mapping check and packaged privacy/viewport
checks also passed.

The run provides `brickbuilder-play-aab-24-1` (signed release AAB, version code
24), `brickbuilder-proguard-24-1`, and native-inset screenshots/reports for API
35 and 36. These are build artifacts with finite retention, not a Play
publication. The remote `main` branch was not changed by the Android push;
the shared archive-verification improvements and this report remain available
for the normal task merge into `main`.
