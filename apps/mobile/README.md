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

- Android sideload APK: `eas build --platform android --profile preview`
- Android Play Store bundle: `eas build --platform android --profile production`
- iOS App Store build: `eas build --platform ios --profile production`

EAS builds require an Expo project ID and authenticated Expo account. Android release signing requires the EAS Android signing key. iOS distribution requires Apple Developer signing and App Store Connect setup. The iOS build is not available from this Windows workstation because Apple signing and Xcode builds require Apple's toolchain.
