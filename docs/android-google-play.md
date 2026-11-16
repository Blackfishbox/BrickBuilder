# Standalone Android and Google Play preparation

This work lives on **`android/google-play`**. The GitHub `main` branch remains
the existing web/PWA application. Nothing uploads an app to Google Play.

## What runs locally

Capacitor 8 packages the Vite output into an Android WebView. Its secure
`https://localhost` origin is an **in-process asset handler**, not a hosted
web server or a connection to the developer's computer. JavaScript, Three.js,
workers, original bundled LDraw resources, connector metadata and the reviewed
catalog snapshot are installed with the app. IndexedDB remains local to the
Android application.

There is no `server.url`, live-reload host, analytics SDK, account,
advertising SDK or Play upload client in the native application. Its manifest
requests INTERNET for optional, default-off first-party geometry downloads,
but no broad storage permission. The PWA service worker is
disabled for the native build; Android updates replace its packaged assets.
The ordinary web/PWA build remains unchanged.

### Important coverage limits

- The complete **mapping/search catalog is not the complete geometry library**.
  The two original packages plus six automatic default packages provide
  312 selectable references (311 physical parts and one compatibility alias).
  See [default offline parts](default-offline-parts.md) for exact coverage,
  licenses, storage increase and verification.
  The existing import-geometry snapshot and geometries already present in a
  project/local database remain available.
- Importing LDR/MPD/IO does not magically supply every missing geometry. The
  native build calls the hosted geometry resolver **only after explicit opt-in**
  in the Android privacy dialog. It does not silently fetch a newer upstream
  dataset. Missing parts retain the existing part-ID warnings.
  A complete, independently installable offline geometry distribution is a
  separate release prerequisite if the store listing promises that coverage.
- Native and browser IndexedDB are separate. Export projects from the PWA as
  internal JSON and import them into Android; do not clear the browser first.
- Local model import continues through the system file chooser. Model export
  and the inventory template use Android's local share/save sheet, not browser
  `blob:` downloads. Choose Files/a document provider there and verify the saved
  file. A cancelled share is not evidence that a backup exists.
- The app does not send model files to a server.
  A share target selected by the user can itself be a cloud application.
- A browser/Node test is **not an Android hardware, WebGL, file-provider, memory
  or performance test**. These checks must happen before production submission.

### Optional geometry API

Enable **Datenschutz (Android) → Fehlende Geometrien online nachladen** to
request missing files from `https://blackfishbox.de/BrickBuilder/api/ldraw/file`.
The setting defaults to off and persists locally. Re-run an unsuccessful import
after enabling it. Disable it to prevent subsequent requests; requests already
sent may finish. Existing cached geometry still works offline.

Native requests use CapacitorHttp, not WebView cross-origin fetch. Keep the
server's browser same-origin protection intact: do not add a wildcard CORS
exception for Android. The URL is fixed, HTTPS-only, redirects are disabled,
timeouts are bounded, and the existing checksum, provenance, license, request
concurrency and per-import budgets remain active. Downloads transmit file paths,
IP addresses and technical metadata, not project files, quantities or colors.
The Apache endpoint must already be installed and reachable; this code does
not provision or publish the Ubuntu server.

Before release, test opt-in, a real missing geometry, a second offline import,
withdrawal and unavailable-server behavior on Android hardware. Review
`docs/privacy-policy.md`, deploy the updated public HTML policy and update
Play Data safety. No end-to-end device or live-server test is implied by unit
tests or `android:prepare`.

## Identity, tools and versions

- Release application ID: `brickbuilder.blackfishbox.de`.
  This identifier is fixed for the new Play listing and cannot be changed after
  the listing is created. It differs from older Android builds
  (`io.github.blackfishbox.brickbuilder`), so those installs cannot be upgraded
  in place and keep separate app data.
- Debug ID: `brickbuilder.blackfishbox.de.debug`; separate projects and
  storage, allowing debug and release apps to coexist.
- Minimum Android: API 24 (Android 7). Target/compile: API 36 (Android 16).
  Actual 3D functionality also requires a working current Android System WebView
  and suitable WebGL/GPU support; the minSdk is not a performance guarantee.
- Node 24, pnpm 10.26.1, JDK 21, Android SDK platform 36 and build tools 36.0.0.
  Use Android Studio 2025.2.1 or newer for Capacitor 8.
- The checked-in Gradle wrapper uses Gradle 8.14.3 and Android Gradle Plugin 8.13.
- No NDK or bundled native `.so` library is introduced by this wrapper and its
  current Java plugins. Recheck 64-bit/16-KB requirements when adding plugins.

Google's policy checked on 2026-11-01 requires API 36 for new submissions
starting 2026-08-31. Recheck the official policy immediately before submission.

## Obtain the reviewed offline catalog

The hash and byte count are pinned in
`artifacts/brickbuilder-mobile/src/features/catalog/manifest.json`:

```text
SHA-256 ad5363fcd70e3d278cb26c69bb0af5291c89628ca84e6e674fccaa8ea6f5475c
Bytes   2180181
```

Keep `catalog.bin` outside Git, for example under
`generated-artifacts/android-inputs/`. Do not substitute a current live
Rebrickable download: its format and hashes differ.

An authorized existing development instance can supply the pinned asset:

```sh
mkdir -p generated-artifacts/android-inputs
curl --fail --location \
  'https://YOUR-DEVELOPMENT-OR-EXISTING-APP/api/catalog/snapshot/ad5363fcd70e3d278cb26c69bb0af5291c89628ca84e6e674fccaa8ea6f5475c' \
  -o generated-artifacts/android-inputs/catalog.bin
sha256sum generated-artifacts/android-inputs/catalog.bin
```

That source is needed **only at build time**, never on the Android device.
The preparation verifies both length and SHA-256 before copying the exact bytes
into the Android asset tree at the existing relative catalog path.

For repeatable GitHub builds, set repository Actions variable `ANDROID_CATALOG_URL`
to the operator's pinned endpoint:

```text
https://blackfishbox.de/BrickBuilder/api/catalog/snapshot/ad5363fcd70e3d278cb26c69bb0af5291c89628ca84e6e674fccaa8ea6f5475c
```

An approved immutable GitHub Release asset is also supported. This is
**licensed, non-user** data. Retain the Rebrickable attribution/terms
listed in the manifest. Never upload an IO model or private project as this
asset. No automatically refreshed external catalog is accepted.

The supplied `android-offline-inputs.zip` contains the reviewed `catalog.bin`,
its manifest and source/license metadata for this build. Keep a durable copy.
The archive itself is not a secret and contains no user model.

## Local build

From the repository root, with the Android SDK/JDK available:

```sh
pnpm install --frozen-lockfile
export ANDROID_CATALOG_PATH="$PWD/generated-artifacts/android-inputs/catalog.bin"
pnpm --filter @workspace/brickbuilder-mobile android:prepare
cd artifacts/brickbuilder-mobile/android
bash gradlew assembleDebug bundleRelease lintRelease
```

On Windows, set the same environment variables in PowerShell and use
`gradlew.bat`. `android:prepare` itself sets the Vite/native environment
cross-platform. Android Studio can manage your local SDK via
`android/local.properties`; never commit that file.

Outputs:

- `app/build/outputs/apk/debug/app-debug.apk`: installable test build.
- `app/build/outputs/bundle/release/app-release.aab`: **unsigned** without upload
  key configuration. It is not accepted by Google Play in this state.

An AAB is not directly installable like an APK. Use the APK for sideload testing
or Play's internal testing to exercise a signed AAB.

## GitHub Actions

Workflow: `.github/workflows/android-google-play.yml`.

Every push to `android/google-play` starts a **signed release AAB** build.
There are no path filters, no unsigned fallback, no silently skipped job when
configuration is missing, and no concurrency rule that cancels queued pushes.
A multi-commit push builds its final tree once, as GitHub's push trigger works.
There is no automatic upload to Google Play. Protect write access to this
branch: code running there can access release secrets.

Configure these repository Actions variables:

| Variable | Value |
| --- | --- |
| `ANDROID_CATALOG_URL` | The pinned public catalog URL above |
| `ANDROID_VERSION_NAME` | Displayed version, initially `0.1.0` |
| `ANDROID_VERSION_CODE_OFFSET` | Initially `0`; increase deliberately if an existing Play upload requires it |

Configure these **repository Actions secrets** (no environment approval is
required on every push):

| Secret | Purpose |
| --- | --- |
| `ANDROID_UPLOAD_KEY_BASE64` | Base64-encoded encrypted upload keystore |
| `ANDROID_UPLOAD_STORE_PASSWORD` | Keystore password |
| `ANDROID_UPLOAD_KEY_ALIAS` | Upload key alias |
| `ANDROID_UPLOAD_KEY_PASSWORD` | Private key password |
| `PRIVACY_CONTROLLER_NAME` | Responsible person's/legal entity's name |
| `PRIVACY_CONTROLLER_STREET` | Street and house number |
| `PRIVACY_CONTROLLER_POSTAL_CITY` | Postal code and city |
| `PRIVACY_CONTROLLER_COUNTRY` | Country |

Do not put these values in YAML, repository variables, commits, tickets or
workflow inputs. Use protected secret entry. Missing secrets fail the build
explicitly with secret **names only**. The source privacy HTML keeps its four
placeholders: `android:prepare` replaces them only in generated assets when
`ANDROID_RELEASE_BUILD=true`, escaping HTML and rejecting empty fields.
The final app necessarily exposes the completed policy to its users; using
secrets keeps personal data out of Git history, not out of the published app.

Open **Actions → Build signed Google Play AAB → the successful run → Artifacts**.
Download `brickbuilder-play-aab-<versionCode>-<attempt>`, extract its ZIP, and
manually upload **`app-release.aab`** in Google Play Console (for example to
internal testing). `release-info.json` records package ID, version, source
commit and workflow run without controller details or credentials. Artifacts
expire after **14 days**; archive the releases you need privately.

`MainActivity` now fits the entire WebView inside actual system-bar, cutout
and keyboard insets. Capacitor's competing inset listener is disabled.
The earlier `viewport-fit=contain` change alone did not establish correct
layout on the user's device; it is not the mechanism of this native fix.
The release workflow gates the AAB on API 35/36 emulator checks of native
bounds, HTML viewport sizing, navigation modes, rotation and keyboard behavior.
See [Native Android system-bar bounds](android-system-insets.md) for ownership,
screenshots and local testing. The browser/PWA viewport remains unchanged.
Physical manufacturer-device testing remains distinct from emulator evidence.

Android model and inventory file pickers use the unrestricted `*/*` MIME
filter. Document providers do not consistently identify IO, LDraw, JSON, XML
or CSV files, and filtering by extensions can leave valid documents disabled.
The existing importers still validate file names, sizes and contents after
selection; this does not grant broad storage permissions or bypass import
validation. Browser/PWA picker filters remain unchanged.

Release builds enable R8 code shrinking and obfuscation. Download
`brickbuilder-proguard-<versionCode>-<attempt>` from the **same workflow run**
to obtain the generated **`mapping.txt`** for native Android crash
deobfuscation in Google Play Console. Keep it together with that exact AAB;
another release's mapping cannot reliably decode its crash reports.
This artifact also expires after **14 days**. The build fails if R8 does not
produce a non-empty mapping. Capacitor's consumer rules preserve its native
plugins, and app rules preserve JavaScript bridge methods and source locations.
This mapping does not decode JavaScript/TypeScript stack traces.

`versionCode` is `ANDROID_VERSION_CODE_OFFSET + github.run_number`. Each new
push/run increases the number; rerunning the same run preserves it. **Every
Play upload must have a strictly higher code than the previous upload.**
Parallel runs may finish out of order, so inspect `release-info.json` before
uploading. A new commit is required for a new code after a previously uploaded
run. Manual dispatch optionally overrides only the display version name.
GitHub normally exposes manual dispatch only when the workflow also exists
on the default branch; automatic Android-branch pushes work without that.

The workflow verifies the AAB signature and checks that its packaged privacy
policy has no unresolved placeholders. It deletes the temporary keystore and
unpackaged personal HTML even on failure, and never uses a debug key for
release. Only the signed AAB, its R8 mapping and non-personal release metadata are uploaded;
no keystore or separately rendered policy is a CI artifact.

GitHub-hosted runner minutes/storage are subject to your GitHub account's
allowance and spending settings. No paid service is configured or purchased.

## Upload key and Play App Signing

The initial upload key for this application is an encrypted PKCS#12 keystore.
Keep an offline copy of the `.p12` file and its password in separate secure
locations. GitHub Actions secrets cannot be downloaded again as a backup.
The key alias and private-key password must match the configured keystore;
the initial setup uses the store password for the private key as well.
Never generate a new key on every workflow run.

Create an upload key locally using Android Studio's **Generate Signed Bundle**
flow or `keytool`, protect it with a strong password, and maintain a secure
offline backup. Store key material only in your own secure storage and GitHub
repository secrets, never in source, chat, a CI artifact or a public issue.
Enable **Play App Signing** in the Play Console. The upload key and Play's app
signing key have different roles; do not substitute the debug key.

For local signed builds, set these environment variables without putting their
values in project files:

```text
ANDROID_UPLOAD_STORE_FILE       absolute path to your upload keystore
ANDROID_UPLOAD_STORE_PASSWORD   keystore password
ANDROID_UPLOAD_KEY_ALIAS        upload key alias
ANDROID_UPLOAD_KEY_PASSWORD     key password
ANDROID_REQUIRE_SIGNING         true
BRICKBUILDER_VERSION_CODE       a new positive increasing number
BRICKBUILDER_VERSION_NAME       e.g. 0.1.0
```

Then run `bash gradlew assembleRelease bundleRelease lintRelease`.

## Play Console checklist — not completed by generating a bundle

- Register/verify the correct developer account. Google may charge a developer
  registration fee; no account or purchase is created by this preparation.
- Confirm application ID, publisher name, support contact and countries.
- Review the offline coverage above and use truthful listing text. The app is
  independent of LEGO, BrickLink, Studio, Rebrickable and LDraw; do not imply
  endorsement or use protected logos as your branding.
- Prepare a 512×512 store icon, 1024×500 feature graphic and genuine Android
  screenshots. Existing browser previews are not native-device screenshots.
  The Android launcher uses the included first-party vector icon.
- Finalize and publish a public HTTPS privacy policy. Start from
  `docs/android-privacy-policy-template.md`, replacing all publisher/contact
  fields. Complete Data safety, ads declaration, content rating, target audience
  and app access declarations based on the actual final binary and SDKs.
- Check per-file LDraw attribution/CC BY and CC0, LDCad shadow CC BY-SA metadata
  obligations and Rebrickable terms for distribution. Keep app code and data
  licensing separate; do not claim the entire payload has one MIT license.
- Use internal testing first. New personal accounts can have mandatory closed
  testing/device verification before production access; follow the current
  requirements shown for your account.
- Test offline immediately after a fresh installation, import/export/save,
  sharing cancellation and low storage, background/kill/restart recovery,
  orientation and system bars, touch gestures, standard snapping, large models
  and devices/WebViews at your declared minimum and current Android.
- Upload the verified **signed AAB**, inspect Play's warnings/pre-launch report,
  and request review only after the above checks. There is no approval guarantee.

## Preparation verification and remaining release gates

The native web payload build, embedded catalog checksum, Capacitor plugin sync,
TypeScript and local export/transport tests can be verified in this workspace.
A native Gradle APK/AAB build requires an Android SDK/JDK or a configured Actions
runner. A generated Gradle project alone is not proof of an installable APK.

The first successful native CI build, real-device testing, signing setup, final
store graphics, publisher/privacy details and Play Console submission remain
explicit release gates. A complete offline geometry expansion is not silently
included or promised by this preparation.

## Launcher artwork

The launcher uses the shared transparent construction-brick icon from
`artifacts/brickbuilder-mobile/public/icons/brickbuilder-512.png`.
To regenerate the five legacy/round icon densities and padded adaptive
foregrounds, install ImageMagick 7 and run:

```sh
bash scripts/android/generate-icons.sh
```

The adaptive background layer is transparent. Launchers can apply their own
mask, background treatment or themed rendering; identical appearance on every
device is not guaranteed. No signing, version increment or store publication is
performed by the icon-generation script.

## Official references

- https://capacitorjs.com/docs/getting-started/environment-setup
- https://capacitorjs.com/docs/android
- https://developer.android.com/studio/publish/app-signing
- https://developer.android.com/guide/app-bundle
- https://support.google.com/googleplay/android-developer/answer/11926878
- https://support.google.com/googleplay/android-developer/answer/14151465
- https://support.google.com/googleplay/android-developer/answer/10787469
