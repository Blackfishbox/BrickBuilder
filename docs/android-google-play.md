# Standalone Android and Google Play preparation

This work lives on **`android/google-play`**. The GitHub `main` branch remains
the existing web/PWA application. Pushes to `android/google-play` build a signed
AAB and submit it to the **closed `alpha` test** using the Google Play API.
The workflow never targets production. `main` does not trigger publishing.

## What runs locally

Capacitor 8 packages the Vite output into an Android WebView. Its secure
`https://localhost` origin is an **in-process asset handler**, not a hosted
web server or a connection to the developer's computer. JavaScript, Three.js,
workers, original bundled LDraw resources, connector metadata and the reviewed
catalog snapshot are installed with the app. IndexedDB remains local to the
Android application.

There is no `server.url`, live-reload host, API base URL, analytics SDK, account,
advertising SDK or Play upload client in the native application. Its manifest
does not request network or broad storage permission. The PWA service worker is
disabled for the native build; Android updates replace its packaged assets.
The ordinary web/PWA build remains unchanged.

The Android-branch release workflow retains only the signed AAB and matching
ProGuard/R8 `mapping.txt` as downloadable GitHub artifacts, and uploads both to
Google Play with German and English release notes. It does not change store
listing text or graphics; those are managed separately in Play Console. The
one-time emulator screen-measurement and screenshot workflow has been removed;
signing, privacy and ordinary regression checks remain.

Native status/navigation bar, display-cutout and keyboard bounds are handled
by the activity's content container, verified by one-time emulator checks. See
[Native Android system-bar bounds](android-system-insets.md).

### Important coverage limits

- The complete **mapping/search catalog is not the complete geometry library**.
  The two original packages plus six automatic default packages provide
  312 selectable references (311 physical parts and one compatibility alias).
  See [default offline parts](default-offline-parts.md) for exact coverage,
  licenses, storage increase and verification.
  The existing import-geometry snapshot and geometries already present in a
  project/local database remain available.
- Importing LDR/MPD/IO does not magically supply every missing geometry. The
  native build will **not call the hosted geometry resolver** or silently fetch
  a newer upstream dataset. Missing parts retain the existing part-ID warnings.
  A complete, independently installable offline geometry distribution is a
  separate release prerequisite if the store listing promises that coverage.
- Native and browser IndexedDB are separate. Export projects from the PWA as
  internal JSON and import them into Android; do not clear the browser first.
- Local model import continues through the system file chooser. Model export
  and the inventory template use Android's local share/save sheet, not browser
  `blob:` downloads. Choose Files/a document provider there and verify the saved
  file. A cancelled share is not evidence that a backup exists.
- The app's permission-free implementation does not send models to a server.
  A share target selected by the user can itself be a cloud application.
- A browser/Node test is **not an Android hardware, WebGL, file-provider, memory
  or performance test**. These checks must happen before production submission.

## Identity, tools and versions

- Release application ID: `brickbuilder.blackfishbox.de`.
  Create or select a Play Console listing for this exact ID before the first
  upload; the ID cannot be changed for that listing.
- The former ID, `io.github.blackfishbox.brickbuilder`, is a different app.
  An existing listing under that ID cannot be converted. Publishing with the
  new ID creates a separate app; existing installs and their data do not
  migrate automatically.
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
  'https://YOUR-DEVELOPMENT-OR-EXISTING-APP/api/catalog/snapshot/ad5363fcd70e3d278cb26c69bb0af5291c89628ca84e6e674fccaa8ea6f5475c/catalog.bin' \
  -o generated-artifacts/android-inputs/catalog.bin
sha256sum generated-artifacts/android-inputs/catalog.bin
```

That source is needed **only at build time**, never on the Android device.
The preparation verifies both length and SHA-256 before copying the exact bytes
into the Android asset tree at the manifest's relative `.bin` path. Do not remove
the filename extension: Capacitor's HTML5 router serves `index.html` for an
extensionless URL, even when a matching catalog asset exists in the AAB.

For repeatable GitHub builds, place this **licensed, non-user** data file in an
appropriate immutable downloadable asset location (for example, an approved
GitHub Release asset) and set repository Actions variable `ANDROID_CATALOG_URL`
to its public HTTPS download URL. Retain the Rebrickable attribution/terms
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

### One-time configuration

1. In Google Cloud, enable the **Google Play Android Developer API** for the
   project containing your service account.
2. In Play Console, invite the service account's email under **Users and
   permissions**. Grant access to `brickbuilder.blackfishbox.de`, permission to
   view app information and **Release apps to testing tracks**. Do not grant
   production-release permissions for this workflow. Ensure the closed track's
   exact API identifier is `alpha`, with its testers/countries configured.
3. The app listing must already exist. If no binary has ever been uploaded,
   perform the first signed AAB upload manually in Play Console; the API cannot
   create the initial app listing. Complete required declarations, Play App
   Signing and any first-release setup before expecting automated publication.
4. In GitHub **Settings → Secrets and variables → Actions**, add the repository
   secret **`GOOGLE_PLAY_SERVICE_ACCOUNT_JSON`**. Paste the complete original
   service-account JSON, including its private key, directly into GitHub's
   secret editor. Do not base64-encode it and do not commit/upload the JSON as
   a source file, chat attachment or build artifact.
   Direct link:
   https://github.com/Blackfishbox/BrickBuilder-Mobile/settings/secrets/actions/new
5. Keep the existing repository signing and privacy secrets configured:
   - `ANDROID_UPLOAD_KEY_BASE64`
   - `ANDROID_UPLOAD_STORE_PASSWORD`
   - `ANDROID_UPLOAD_KEY_ALIAS`
   - `ANDROID_UPLOAD_KEY_PASSWORD`
   - `PRIVACY_CONTROLLER_NAME`
   - `PRIVACY_CONTROLLER_STREET`
   - `PRIVACY_CONTROLLER_POSTAL_CITY`
   - `PRIVACY_CONTROLLER_COUNTRY`
6. Set repository Actions variable `ANDROID_CATALOG_URL` to the reviewed asset's
   HTTPS URL. Optionally set `ANDROID_VERSION_NAME` (default `0.1.0`) and
   `ANDROID_VERSION_CODE_OFFSET` (default `0`).

### What each push does

1. A push to `android/google-play` runs the existing tests, builds the signed
   release AAB, checks its signature/privacy policy and generates R8 mapping.
   Missing or malformed publishing secrets fail early with a clear error.
2. The AAB and matching `mapping.txt` remain available in the run's **Artifacts**
   for 14 days, even if the later Play upload fails. No emulator screenshots
   or measurement reports are produced.
3. A separate publish job downloads those exact artifacts and generates German
   (`de-DE`) and English (`en-US`) release notes, each limited to 500 characters.
   It compares commits against the last successful automated release, so
   intervening failed runs are included. Before the first successful automated
   release, it summarizes the current push's changes; manual runs use the latest
   commit unless localized notes are supplied.
4. The pinned upload action sends the AAB, R8 mapping and both sets of notes to
   app `brickbuilder.blackfishbox.de`, track **`alpha`**, with release status
   **`completed`** and `changesNotSentForReview: false`. The workflow does not
   modify store listing text or graphics, including a manually maintained
   English (`en-US`) listing.

The notes are precise, hand-written German and English commit trailers, not an AI
translation or a claim that every changed area contains a verified bug fix.
They require no paid API. Every app-change commit needs both
`Release-Notes-DE` and `Release-Notes-EN`; complete-batch trailers can cover
older commits during a localization rollout. For manual notes, use **Run
workflow**, select `android/google-play`, and fill in `release_notes_de` and/or
`release_notes_en`. The optional `version_name` input overrides the displayed
version. The GitHub Actions step summary shows both localized notes.

`completed` requests rollout to all eligible testers of this closed track.
Google review, managed publishing, incomplete declarations or account
restrictions can delay/prevent availability; the workflow cannot bypass them.
It does not create a production release or change the tester list.
If Google rejects the submission, the job fails explicitly; it does not silently
retry as a draft or leave the changes unsubmitted for review.

Publishing jobs are serialized to avoid conflicting Play edits; active uploads
are never cancelled. Under GitHub concurrency rules, a newer waiting publish
job can replace an older waiting one during rapid pushes. Every push still has
its own independent build and downloadable artifacts. An older run is refused
if a newer automated release has already succeeded. Avoid editing the same
release manually in Play Console while an automated upload is running.

The version code is `ANDROID_VERSION_CODE_OFFSET + GITHUB_RUN_NUMBER`.
**Every Play upload must have a strictly higher code than previous uploads**,
including manual uploads. Adjust the offset before enabling automation if
necessary. Re-running a run that already uploaded its AAB does not create a new
code; start a new manual run or push a new commit instead.

The workflow verifies signatures and uses the existing permanent upload key,
never a debug key or a newly generated replacement. Private controller details
are injected at build time as before, not committed to the repository.

GitHub-hosted runner minutes/storage are subject to your GitHub account's
allowance and spending settings. No paid service is configured or purchased.

## Upload key and Play App Signing

Create an upload key locally using Android Studio's **Generate Signed Bundle**
flow or `keytool`, protect it with a strong password, and maintain a secure
offline backup. Store key material only in your own secure storage and GitHub
environment secrets, never in source, chat, an artifact or a public issue.
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

## Official references

- https://capacitorjs.com/docs/getting-started/environment-setup
- https://capacitorjs.com/docs/android
- https://developer.android.com/studio/publish/app-signing
- https://developer.android.com/guide/app-bundle
- https://support.google.com/googleplay/android-developer/answer/11926878
- https://support.google.com/googleplay/android-developer/answer/14151465
- https://support.google.com/googleplay/android-developer/answer/10787469
