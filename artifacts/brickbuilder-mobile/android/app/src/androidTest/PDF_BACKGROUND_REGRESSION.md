# Android PDF background-export regression check

These checks are intentionally manual and device-only. They are not part of
release builds. They do not capture screenshots or perform automatic screen
measurements.

## Run the native checks

Connect an Android 13+ device or emulator, then run from the repository root:

```sh
bash scripts/android/check-pdf-background-manually.sh
```

The instrumentation test launches the real BrickBuilder Capacitor WebView and
foreground service. It checks that WebView timers keep advancing when the app is
backgrounded, that refusing notification permission does not block the service,
that the notification cancel action stops it, and that the PDF wake lock is
released after stopping. The test restores the app's original notification
permission state.

## Check real PDF exports on a device

Use a project with at least one instruction step. For the Studio case, import an
`.io` project that has readable Studio instruction pages. Run each row for both
**Export instructions as PDF** and **Export using the imported Studio page
layout**:

| Interruption | Steps | Expected result |
| --- | --- | --- |
| Switch to another app | Start the export, open another app until rendering finishes, then return to BrickBuilder. | Rendering finishes in the background; the ready notification appears; sharing waits until BrickBuilder is foregrounded. |
| Screen off and unlock | Start the export, turn the display off for the render, then wake and unlock the device. | Rendering continues; after unlock, BrickBuilder returns without restarting the export and can open the completed PDF. |
| Notifications denied | Deny `POST_NOTIFICATIONS` when Android asks, then start the export and let it finish. | Export continues without a visible notification; BrickBuilder remains usable and the completed PDF can be opened after returning. |
| Cancel from notification | Allow notifications, start rendering, and tap **Cancel** in the ongoing notification. | Rendering stops, no PDF is shared, the progress notification disappears, and the CPU is no longer held awake by the PDF export. |

To restore notification permission after a manual denial, use Android Settings
for BrickBuilder or run:

```sh
adb shell pm grant brickbuilder.blackfishbox.de.debug android.permission.POST_NOTIFICATIONS
```

After notification cancellation, confirm the wake lock was released:

```sh
adb shell dumpsys power | grep -F 'BrickBuilder:PdfExport'
```

The command should print no matching held wake lock after the service has
stopped. On devices where Android groups or hides notifications, use the
instrumented notification-action check and the service state instead of
assuming that an absent notification means the export stopped.
