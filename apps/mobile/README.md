# KashFlow mobile field app

This is a native iOS and Android app built with React Native and Expo Router. It has separate Today, Stock, Count, Sync & Review, and Settings screens; it does not display the KashFlow website in a WebView.

## Offline inventory

- The item catalog, active locations, and location balances are cached after a successful sign-in and refresh.
- Physical counts are written to SQLCipher storage before any network request. The SQLCipher key and API session are kept in the iOS Keychain or Android Keystore through SecureStore.
- Reconnect prompts let the user send saved counts. The API accepts idempotency keys so a retry after a dropped connection cannot post the same adjustment twice.
- If the server balance changed after the saved baseline, the count stops for review. The user is asked to physically recount against the fresh balance before sending a replacement count.
- Sign out clears the local encrypted database and the local database key.
- Provider actions such as M-Pesa STK, KRA eTIMS submissions, and remote bank feeds need a live connection.

The first catalog download needs a connection. If an item or branch was not cached before going offline, it cannot be counted on that device until the next refresh.

## Development and builds

Set `EXPO_PUBLIC_API_BASE_URL` to the API origin, for example `http://localhost:3001` for local development or the production API URL. This is a public service URL, not a secret. The API accepts the app's native bearer session; no web view or cookie-sharing bridge is used.

Install dependencies with `npm ci`, then run `npm start`. Use a native development build or EAS build; Expo Go does not include the SQLCipher native configuration and the app deliberately refuses an unencrypted local database.

- Android sideload APK: `npx eas-cli build --platform android --profile preview`
- Android Play Store bundle: `npm run build:android`
- iOS App Store build: `npm run build:ios`

EAS builds require an Expo project linked to this app. Put its ID in `EXPO_PROJECT_ID` (shown in `.env.example`) and authenticate with `EXPO_TOKEN` or `npx eas-cli login`; never commit the token. GitHub Actions can use an `EXPO_TOKEN` repository secret and an `EXPO_PROJECT_ID` repository variable after the project is linked. Android release signing requires the EAS Android signing key. iOS distribution requires Apple Developer signing and App Store Connect setup. EAS can build iOS remotely, but the project still needs Apple signing credentials for device distribution.

After configuring those GitHub settings, run **Actions → Build KashFlow mobile apps** and choose Android, iOS, or both. The workflow waits for each EAS build, downloads the completed package, and attaches it to the GitHub Actions run for 30 days. The `preview` profile produces an Android installable APK and an iOS ad hoc IPA when the required Apple signing credentials and registered devices are configured. `production` produces an Android app bundle and an iOS App Store IPA. These CI artifacts are for review; the landing page only shows mobile downloads after a stable release asset or public store listing is available.
