# Android privacy policy and optional geometry downloads

The German, user-facing policy is the self-contained HTML page at
`artifacts/brickbuilder-mobile/public/privacy.html`. It applies only to the
Android build with optional geometry downloads, not hosted PWA installations. It is accessible from
the project menu without leaving the editor, is bundled for offline access and
contains no scripts, remote fonts or external images.

Before store publication:

1. Have the text legally reviewed and verify the actual release still matches
   its statements, especially native geometry transport, sharing, local storage
   and the absence of analytics/advertising SDKs.
2. Upload the same HTML document to a publicly accessible, stable HTTPS URL.
   No login, geofencing, PDF-only download or editable-document link should be
   required. No public URL has been configured or published by this change.
3. Enter that URL in Play Console. Complete the Data safety form based on the
   actual release and Google's definitions; a policy alone does not complete it.
4. If a website is used, separately assess its host, access logs and other data
   processing. Do not claim this Android-only policy covers hosted web apps.
5. If optional services, SDKs, cloud sync or network downloads are introduced,
   review the policy and store disclosures before release.

## Optional first-party API

Geometry downloads are off by default. The Android privacy dialog records a
device-local opt-in; withdrawal stops subsequent requests, not packets already
sent. Missing geometry and dependency/legal file paths are requested from
`https://blackfishbox.de/BrickBuilder/api/ldraw/file`. No project upload, local
filename, quantity, color or model name is sent. Part requests can nevertheless
reveal model interests. Downloaded geometry stays in the existing verified local
cache; bundled geometry and offline editing remain available without consent.

Before publishing this release, verify the real server's hosting provider,
location, subprocessors and Apache access/error log retention. Add the actual
provider/location and a concrete retention period to the public policy where
applicable; these facts are not known from the repository and must not be
invented. Configure deletion/rotation accordingly. The current policy explains
the purposes and retention criteria but does not assert an unverified fixed
number of days or hosting location. Check international-transfer safeguards
if the actual hosting arrangement requires them. Update Play Data safety for
the actual network-enabled release, including IP addresses/technical data.

Replace the HTML served at the existing `/brickbuilder-datenschutz` URL with
`artifacts/brickbuilder-mobile/public/privacy.html`; updating a Git branch does
not update the copy already installed on the Ubuntu server.

User-selected cloud document providers and share targets can transfer exported
files independently. The native exporter leaves files in the app cache until
Android/the user clears them; the policy deliberately does not promise immediate
deletion or additional file encryption.

Official reference:
https://support.google.com/googleplay/android-developer/answer/10144311
