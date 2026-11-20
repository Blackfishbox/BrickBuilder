# Large SVG Android acceptance

## Current evidence

The renderer stress test exports **160,001 distinct source triangles**. The
mocked Capacitor filesystem/share integration test uses a smaller 80,001-triangle
model so the full SVG, XML parse and delayed native-style append remain within a
practical test time. It verifies a multi-megabyte transparent SVG survives
chunk encoding, a delayed append completes before sharing, and a later cache
append failure prevents sharing. Another test verifies async SVG chunks become
one browser download. A dialog test checks that a native save failure is
visible and a retry is possible.

These are not Android device tests. A delayed mocked promise does not reproduce
WebView suspension, process death, native disk I/O or a receiving application's
handling of a content URI. **Native Android acceptance remains unverified.**
The execution environment used for preparation had no `adb`, emulator, connected
device or `/dev/kvm`.

## Reproduce the reference

From the repository root:

```sh
pnpm --filter @workspace/brickbuilder-mobile exec tsx scripts/large-svg-fixture.ts
PORT=4173 BASE_PATH=/ pnpm --filter @workspace/brickbuilder-mobile exec vitest run \
  src/platform/export-file.test.ts src/features/formats/view-export-dialog.test.tsx
```

The generator writes `generated-artifacts/android-svg-share/reference.svg`
and `reference.json` containing its byte length, source triangle count and SHA-256.
No downloaded parts, PNG render, budget changes or private model are involved.
The mesh and fixed camera are defined in
`artifacts/brickbuilder-mobile/test-fixtures/large-svg-model.ts`.
The reference file alone is **not** an editor-importable model or proof of
native sharing.

## Required native session

Use a disposable debug installation on a connected Android device. Record app
build, Android version, WebView version and receiving app/version. Do not fill
the storage of a personal device to simulate errors.

1. In a debug harness, construct `largeSvgModel()`, call
   `renderSvgView([model], camera, 2160, 3840)`, then pass the resulting byte
   stream to the application's **actual** `exportFile(stream, "reference.svg",
   "image/svg+xml")`. Dispose the fixture afterwards. A harness is needed:
   there is deliberately no diagnostic model or test-only control in release UI.
2. Share to a real SVG-capable receiving application, save its received file,
   reopen it, and confirm all geometry and a transparent background. Compare
   the saved bytes and SHA-256 with the generated reference, and parse the saved
   XML to ensure it ends with `</svg>` and has no raster image fallback.
   An unchanged filename or a displayed share sheet is not sufficient evidence.
3. Repeat, pressing Home or switching apps **during a native append**, before
   the share sheet opens, then return and finish sharing. For reliable timing,
   use a debug-only latch around a later native append and record its release;
   do not replace the native filesystem implementation with a mock. Confirm
   no share sheet opens before the final append succeeds, and repeat the
   received-file size, hash, XML and transparency checks.
4. In a disposable debug session, inject a native cache write/append failure
   (both initial creation and a later chunk). Through the export dialog confirm
   an error appears, no partial file is offered for sharing, and a subsequent
   export succeeds with a new path. Do not treat a mocked JS rejection as
   device-level cache-failure evidence.
5. Record whether Android killed the process. Simple background/foreground is
   the required scenario; process-death recovery is separate and is not claimed
   by these tests.

Save the device report, received SVG and hashes outside Git under
`generated-artifacts/android-svg-share/`. Mark this task accepted only after
the native session succeeds. No native harness/session has been run or claimed
by the preparation work.
