# Android Premium

Premium uses RevenueCat's official Capacitor SDK and Google Play Billing. It is
a **non-consumable one-time purchase**, not a subscription. The PWA does not
initialize billing and keeps its existing behavior.

## Store setup before accepting real purchases

The RevenueCat project is **BrickBuilder**. The app uses:

- Android application ID: `brickbuilder.blackfishbox.de`
- Google Play one-time product ID: `brickbuilder_premium`
- RevenueCat entitlement: `brickbuilder_premium`
- Current offering's lifetime package: `$rc_lifetime`

1. In Google Play Console, create the one-time product `brickbuilder_premium`.
   Configure its localized name, description, countries, one-time price, and an
   active buy purchase option. Do not create a subscription.
2. In RevenueCat, open **BrickBuilder → Apps → BrickBuilder Android** and connect
   the Google Play service account with the required purchase-management
   permissions. Follow RevenueCat's current Google Play setup guide. Never put
   the service-account JSON into source control or the application bundle.
3. Confirm the Play product is attached to entitlement `brickbuilder_premium`
   and the current offering's `$rc_lifetime` package. The preparation script
   already sets up these RevenueCat associations; it does not create an active
   Google Play listing, choose a price, or grant Google permissions.
4. Add license testers in Play Console and install the signed app through its
   closed test track using an eligible Google account.
5. Verify purchase, cancellation, pending payment, restoration after clearing
   app data/reinstalling, and refund/revocation on a real Android device.
   Use a disposable local test project when clearing app data.

The app displays the localized price returned by Google Play through RevenueCat,
never a hardcoded amount. It only offers the configured lifetime product, not
an arbitrary subscription from the current offering.

## Access rules

- The purchase menu appears directly below Privacy & settings, only on Android
  after a non-Premium status has been established. A status-check failure offers
  a retry rather than falsely claiming that a purchase is absent.
- Only RevenueCat's active entitlement grants access. Failed signature
  verification is rejected. No local-storage boolean can grant Premium.
- Pending and cancelled purchases do not unlock anything.
- SDK-cached entitlements can be used offline. Refund and other entitlement
  changes are applied when RevenueCat reports them; offline access cannot
  reflect a remote revocation until the device reconnects.
- Additional geometry downloads require both Premium and the separate existing
  privacy opt-in. Buying Premium never switches that opt-in on.
- Premium adds a switch in Instructions to omit BrickBuilder footer branding in
  both standard and Studio PDF exports. The export boundary rechecks access.
- The Android activity uses `singleTop`, as required for payment verification
  in another app. Cold and warm `.io` file intents remain supported.

## RevenueCat preparation

Run manually from this workspace when setting up a new RevenueCat account:

```sh
pnpm --filter @workspace/scripts exec node src/seedRevenueCat.mjs
```

This idempotent script uses the server-side Replit RevenueCat connector. It
creates only missing RevenueCat configuration and writes the **public Android
SDK key** to the app configuration. That public key is intended for distribution
in the app. No secret REST key or Google service-account credential belongs in
that file. The native build does not need access to the Replit connector.

Privacy disclosures are in the app's bilingual `privacy.html`. The separately
hosted Play Store privacy page must also reflect Premium processing before
the paid version is made available.
