#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OUTPUT="$ROOT/generated-artifacts/native-insets"
mkdir -p "$OUTPUT"
collect_evidence() {
  adb pull /sdcard/Android/data/brickbuilder.blackfishbox.de.debug/files/inset-evidence "$OUTPUT/" || true
  adb logcat -d > "$OUTPUT/emulator-logcat.txt" || true
}
trap collect_evidence EXIT
adb shell settings put secure show_ime_with_hard_keyboard 1
cd "$ROOT/artifacts/brickbuilder-mobile/android"
bash gradlew --no-daemon :app:testDebugUnitTest :app:connectedDebugAndroidTest \
  -Pandroid.injected.androidTest.leaveApksInstalledAfterRun=true \
  -Pandroid.testInstrumentationRunnerArguments.class=brickbuilder.blackfishbox.de.NativeInsetsInstrumentedTest
