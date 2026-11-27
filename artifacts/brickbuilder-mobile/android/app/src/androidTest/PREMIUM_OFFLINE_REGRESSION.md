# Premium offline process-lifecycle regression

These device tests use the installed RevenueCat Android SDK and its real
CustomerInfo cache. They are not simulated by the TypeScript RevenueCat mock.
Run them on a physical Android device or emulator with Google Play services,
using a RevenueCat/Play test account and a test purchase. Do not use a
production purchase.

The phases are deliberately separate: stopping the app process is required
between the online cache-priming test and the offline assertion. The test also
compares the app's geometry-consent preference across each restart.

Run commands from `artifacts/brickbuilder-mobile/android` with the test device
connected. Substitute the matching method name after `#`.

## Owned Premium

1. Use an owned test account with the `brickbuilder_premium` lifetime entitlement.
   Keep connectivity on and prime the native cache:

   ```sh
   ./gradlew :app:connectedDebugAndroidTest \
     -Pandroid.testInstrumentationRunnerArguments.class=brickbuilder.blackfishbox.de.PremiumCacheLifecycleInstrumentedTest#primeOwnedCacheAndGeometryConsentBaseline
   ```

   This confirms RevenueCat reports ownership, confirms the Premium menu entry
   is hidden, and sets geometry consent to `enabled` as a test fixture.
2. Disable Wi-Fi and mobile data, then force-stop the debug app package to kill
   the process. Launch the device test again:

   ```sh
   adb shell svc wifi disable
   adb shell svc data disable
   adb shell am force-stop brickbuilder.blackfishbox.de.debug
   ./gradlew :app:connectedDebugAndroidTest \
     -Pandroid.testInstrumentationRunnerArguments.class=brickbuilder.blackfishbox.de.PremiumCacheLifecycleInstrumentedTest#ownedLifetimeEntitlementSurvivesOfflineProcessRestart
   ```

   The app is launched in a fresh process. The test verifies the native SDK
   returns the cached active entitlement, the Premium purchase entry stays
   hidden, and geometry consent remains `enabled`.

## Unowned installation

Use a separate unowned test account/device state. Prime its no-entitlement
CustomerInfo online, then repeat the force-stop/offline launch:

```sh
adb shell svc wifi enable
adb shell svc data enable
./gradlew :app:connectedDebugAndroidTest \
  -Pandroid.testInstrumentationRunnerArguments.class=brickbuilder.blackfishbox.de.PremiumCacheLifecycleInstrumentedTest#primeUnownedCacheAndGeometryConsentBaseline
adb shell svc wifi disable
adb shell svc data disable
adb shell am force-stop brickbuilder.blackfishbox.de.debug
./gradlew :app:connectedDebugAndroidTest \
  -Pandroid.testInstrumentationRunnerArguments.class=brickbuilder.blackfishbox.de.PremiumCacheLifecycleInstrumentedTest#unownedInstallationStaysLockedAfterOfflineProcessRestart
```

This verifies the cached unowned result does not unlock Premium and that the
separate `disabled` geometry-consent choice is unchanged. To start with a fresh
unowned installation instead, clear the debug app's data first, launch once
online, and run the cache-priming test.

## Revocation after reconnect

Starting from the owned offline state, revoke the test customer's lifetime
entitlement in the RevenueCat test setup while the device remains offline.
Restore connectivity, force-stop the app, then run:

```sh
adb shell svc wifi enable
adb shell svc data enable
adb shell am force-stop brickbuilder.blackfishbox.de.debug
./gradlew :app:connectedDebugAndroidTest \
  -Pandroid.testInstrumentationRunnerArguments.class=brickbuilder.blackfishbox.de.PremiumCacheLifecycleInstrumentedTest#reconnectingAppliesRevocationWithoutChangingGeometryConsent
```

The test gives RevenueCat up to seven minutes for its normal cache refresh to
observe the server-side revocation. It then verifies the Premium purchase
entry returns and geometry consent remains `enabled`.

Restore network settings after the run with `adb shell svc wifi enable` and
`adb shell svc data enable`.
