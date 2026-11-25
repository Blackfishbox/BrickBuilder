#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT/artifacts/brickbuilder-mobile/android"

# Run only on an attached Android device or emulator, on explicit request.
# This is intentionally not part of the Android release workflow.
bash gradlew --no-daemon :app:connectedDebugAndroidTest \
  -Pandroid.testInstrumentationRunnerArguments.class=brickbuilder.blackfishbox.de.PdfBackgroundExportInstrumentedTest
