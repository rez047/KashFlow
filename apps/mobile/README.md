# KashFlow mobile app

This is a native iOS and Android app built with React Native and Expo Router. It opens on the **Business** tab with the complete KashFlow business suite. Today, Stock, Count, Sync & Review, and Settings provide native tools for offline field work.

The Business tab loads the configured KashFlow frontend in a WebView and uses the app's bearer session. Session tokens stay in iOS Keychain or Android Keystore and pass through the web page in memory; business switches and sign-out update the native session. Set `EXPO_PUBLIC_WORKSPACE_URL` to use a different frontend deployment. Open the suite while connected once to cache its app shell and workspace data; supported edits then queue locally and sync when online. Each phone has its own queue, so another device sees those changes after they reach the API. POS camera scanning uses the device camera only after a barcode scan is requested. CSV exports are shared as a single CSV or a ZIP of all selected exports, and printing uses the device print sheet.

## Offline inventory

- The item catalog, active locations, and location balances are cached after a successful sign-in and refresh.
- Physical counts are written to SQLCipher storage before any network request. The SQLCipher key and API session are kept in the iOS Keychain or Android Keystore through SecureStore.
- Reconnect prompts let the user send saved counts. The API accepts idempotency keys so a retry after a dropped connection cannot post the same adjustment twice.
- If the server balance changed after the saved baseline, the count stops for review. The user is asked to physically recount against the fresh balance before sending a replacement count.
- Sign out clears the local encrypted database and the local database key.
- Account deletion is available from Settings while online. It reauthenticates with the current password, requires sole administrators to archive their workspace first, removes server authentication and memberships, preserves shared workspace records, and clears the local vault after success.
- Daraja STK prompts and KRA eTIMS submissions can wait in the workspace sync queue, but are sent only after reconnect. Payment or fiscal acceptance still comes from Safaricom or KRA; it is never assumed offline. Remote bank refreshes need a live connection.

The first catalog download needs a connection. If an item or branch was not cached before going offline, it cannot be counted on that device until the next refresh.

## Development and builds

Set `EXPO_PUBLIC_API_BASE_URL` to the API origin, for example `http://localhost:3001` for local development or the production API URL. Set `EXPO_PUBLIC_WORKSPACE_URL` to the matching frontend origin when testing against a non-production deployment. Both are public service addresses, not secrets. The API accepts the app's native bearer session.

Install dependencies with `npm ci`, then run `npm start`. Use a native development build or EAS build; Expo Go does not include the SQLCipher native configuration and the app deliberately refuses an unencrypted local database.

- Android sideload APK: `npx eas-cli build --platform android --profile preview`
- Android Play Store bundle: `npm run build:android`
- iOS App Store build: `npm run build:ios`

EAS builds require an Expo project linked to this app. Put its ID in `EXPO_PROJECT_ID` (shown in `.env.example`) and authenticate with `EXPO_TOKEN` or `npx eas-cli login`; never commit the token. GitHub Actions can use an `EXPO_TOKEN` repository secret and an `EXPO_PROJECT_ID` repository variable after the project is linked. Android release signing requires the EAS Android signing key. iOS distribution requires Apple Developer signing and App Store Connect setup. EAS can build iOS remotely, but the project still needs Apple signing credentials for device distribution.

## Publishing to the landing page

Push a stable `v*` tag (for example `v1.2.0`) or run **Actions → Attach mobile apps to release** and supply an existing tag. The workflow waits for the EAS `preview` build, downloads the signed installable APK, and attaches it to that GitHub release as `KashFlow-Field-Android-<tag>.apk`. The landing page matches that asset by name and serves it as a direct download button.

Android sideloading always triggers the "install from this source" / Play Protect prompt on the device. That prompt cannot be suppressed for an APK; it only disappears with a Google Play release.

## Store testing releases

The **Build and upload mobile store test releases** GitHub Actions workflow creates production-signed Android App Bundles and iOS App Store builds, then uploads Android to the Play internal testing track and iOS to App Store Connect/TestFlight. It does not promote a Play release to production or submit an iOS version for App Review.

Before running the workflow:

- Set the `EXPO_PROJECT_ID` repository variable and `EXPO_TOKEN` repository secret.
- Configure Android production signing and a Google Play service account key in the linked EAS project. The Android application ID must already exist in Play Console.
- Enroll in the Apple Developer Program, create the App Store Connect app record for `ke.kashflow.inventory`, set the `IOS_ASC_APP_ID` and `APPLE_TEAM_ID` repository variables, and configure the App Store Connect API key and iOS distribution credentials in EAS.
- Complete each store's listing, privacy, data-safety, and account-deletion requirements before requesting public review.

Public review is not ready yet: the account-deletion flow is implemented, but the repository has no published privacy-policy page or finalized retention schedule and backup-expiry policy. Store listing deletion disclosures still need a public destination that explains how to reach the in-app deletion flow. The Business tab also relies on a hosted WebView, so Apple may assess whether the native offline inventory tools provide enough functionality beyond the website.

The workflow requires a new `workflow_dispatch` run for each upload. Select `all`, `android`, or `ios` in GitHub Actions. Store credentials belong in EAS or GitHub's encrypted secrets; never commit or send them in chat.

### iOS

An `.ipa` cannot be installed by tapping a link in a browser — Apple permits distribution only through TestFlight or the App Store. The landing page therefore never links an `.ipa`; it shows an Apple button only when `VITE_IOS_DISTRIBUTION_URL` is set to a real TestFlight or App Store listing URL, and otherwise shows "App Store release pending". Set that site environment variable after the app is listed. iOS device distribution also requires a paid Apple Developer account and registered devices for ad hoc builds.
