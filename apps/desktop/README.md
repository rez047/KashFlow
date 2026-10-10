# KashFlow desktop field app

This is a dedicated Electron desktop app with its own Overview, Inventory, Stock Count, Sync & Review, and Settings pages. It does not load the KashFlow website.

The inventory snapshot and pending count queue are encrypted through the operating system's secure storage: Windows DPAPI, macOS Keychain, or a Linux desktop keyring. The app refuses to save business data on Linux if Electron falls back to its weak `basic_text` backend. Offline counts are replayed with idempotency keys; changed stock baselines stop for a physical recount.

## Development

```powershell
npm ci
npm run dev
```

Set `KASHFLOW_API_BASE_URL` to the KashFlow API origin if the production URL differs from the default. For local API development, use `http://localhost:3001`.

## Packaging

- Windows installer: `npm run build:win`
- Universal macOS DMG and ZIP: `npm run build:mac` (run on macOS)
- Linux AppImage and DEB: `npm run build:linux`

## Publishing to the landing page

The **Build KashFlow Field installers** GitHub Actions workflow packages Windows and universal macOS installers on hosted runners.

The landing page reads the newest published (non-draft, non-prerelease) GitHub release and links any asset whose name matches `KashFlow-Desktop-*-Setup.exe` (Windows) or `KashFlow-Desktop-*.dmg` (macOS). Do not rename those artifacts.

- **Stable release:** push a `v*` tag (for example `v1.2.0`). The workflow publishes a public GitHub release with the installers attached, so the landing page download buttons work immediately.
- **Draft for manual signing:** push a `field-v*` tag to create a draft release instead, for review before publishing.

### Code signing

The workflow signs automatically when the following repository **secrets** are set, and otherwise builds unsigned:

| Platform | Secrets |
|---|---|
| Windows | `WINDOWS_CSC_LINK`, `WINDOWS_CSC_KEY_PASSWORD` |
| macOS | `MACOS_CSC_LINK`, `MACOS_CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` |

The certificate links accept a base64-encoded certificate or a secure download URL, as expected by `electron-builder`. Without them the workflow logs a warning and the installer is unsigned, which triggers SmartScreen on Windows and Gatekeeper on macOS for your customers.

macOS notarization requires a paid Apple Developer account. electron-builder's `notarize` option is deliberately left off because it must be paired with valid App Store Connect credentials; enable it only once those are configured in CI.
