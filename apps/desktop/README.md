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

The **Build KashFlow Field installers** GitHub Actions workflow can package Windows and universal macOS installers on hosted runners. Run it manually to download 30-day build artifacts, or push a `field-v*` tag to create a draft GitHub release for review. Draft installers are unsigned; code sign Windows builds and sign and notarize macOS builds before publishing to customers.
