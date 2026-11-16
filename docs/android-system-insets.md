# Native Android system-bar bounds

## Ownership

`MainActivity` installs `NativeInsets` on the activity's actual
`android.R.id.content` container. Capacitor inflates its own bridge layout;
the unused application `activity_main.xml` is not a reliable place to fit it.

The window draws edge-to-edge as required by current Android targets, but the
native content container pads the **whole WebView** inside the union of system
bars, display cutouts and the visible keyboard. Keyboard and navigation bottom
insets use their maximum, not their sum. Original padding is captured once;
rotation, resume and repeated inset dispatches cannot accumulate padding.

`SystemBars.insetsHandling` must be `disable`: Capacitor must not install a
second decor/CSS inset owner. Children receive zero already-handled bar,
cutout and IME insets rather than `CONSUMED`, allowing subsequent WebView inset
updates without double CSS safe-area padding. The activity uses `adjustResize`
for IME inset delivery. No bar height or device density is hardcoded.

The previous `viewport-fit=contain` workaround can remain in the Android asset
pipeline, but **is not the mechanism or proof of this fix**. Browser/PWA layout
and controls are unchanged.

## Native regression gate

The existing signed-release workflow calls
`.github/workflows/android-native-insets.yml` before releasing an AAB.
It boots API 35 and 36 emulators, loads the real editor, switches between
three-button and gesture navigation, and measures actual native WebView bounds
against the window's reported system/IME insets and verifies that the DOM
viewport and bottom controls fit inside the fitted native WebView.

The calling release workflow passes its effective catalog URL into the
reusable workflow's `catalog_url` input, so manual input overrides and the
release job use the same snapshot. For standalone dispatch, provide that URL
explicitly or configure the repository's `ANDROID_CATALOG_URL` fallback.

Navigation verification reads the enabled system overlay and checks the actual
button inset against the measured gesture inset. Android 15 can retain stale
overlay-resource values in an already running application's Resources object;
those values are not a reliable assertion of SystemUI's navigation mode.

It covers portrait, landscape, returning to portrait, keyboard opening/closing
and pause/resume. Screenshots and numeric bounds are retained in
`android-native-insets-api-<api>-<attempt>` for 14 days, including failure
evidence where available. The test build uses privacy placeholders, not
controller secrets. Local padding tests also cover side cutouts and repeated
calculation from an unchanged baseline.

Run on a connected emulator/device after `android:prepare`:

```sh
bash scripts/android/check-native-insets.sh
```

Use a fresh test emulator without private projects: screenshots capture its
visible editor. The script retains the test APK until screenshot collection.
The scripted navigation-overlay commands require a test device which exposes
Android's navigation emulation overlays. A passing emulator check is not a
claim that a physical manufacturer's device was tested.

Keep the existing release signing, per-push version codes, private policy
injection and matching ProGuard mapping intact. Never replace the current
Android branch with a snapshot of the older local web/main Android shell.
