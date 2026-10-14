# KashFlow desktop app

The desktop app opens to the encrypted offline Field Edition with **Today**, **Stock**, **Count**, and **Sync** navigation always visible. Select **Business** in the sidebar or use `Ctrl/Cmd+1` to open the KashFlow suite inside the same app window. After the suite has loaded once while connected, its cached app shell and downloaded workspace data remain available offline; supported edits queue on this computer for sync when connectivity returns. Use the **Workspace → Offline field tools** menu item or `Ctrl/Cmd+2` to return to the native field screens.

The inventory snapshot and pending count queue are encrypted through the operating system's secure storage: Windows DPAPI, macOS Keychain, or a Linux desktop keyring. The app refuses to save business data on Linux if Electron falls back to its weak `basic_text` backend. Offline counts are replayed with idempotency keys; changed stock baselines stop for a physical recount.

The suite is served from `https://kashflow-frontend.onrender.com` by default. Its requests use the desktop session; business switches and sign-out update the local session. Each desktop and workspace stores its own offline queue; reconnect before expecting its changes on another device. Safaricom STK prompts and KRA submissions wait for connectivity, and provider confirmation is still required. Set `KASHFLOW_WORKSPACE_URL` before launch to use a different HTTPS frontend deployment. CSV exports and printing use Electron's normal save and print dialogs. POS camera scanning is limited to video requests from the configured KashFlow frontend.

## Development

```powershell
npm ci
npm run dev
```

Set `KASHFLOW_API_BASE_URL` to the KashFlow API origin if the production URL differs from the default. For local API development, use `http://localhost:3001`. To open a local web frontend from **Full workspace**, set `KASHFLOW_WORKSPACE_URL` to its HTTPS origin (or a localhost URL during development).

## Packaging

- Windows installer: `npm run build:win`
- Universal macOS DMG and ZIP: `npm run build:mac` (run on macOS)
- Linux AppImage, DEB, and Snap package: `npm run build:linux`
- Mac App Store package: `npm run build:mac:store` (requires the Apple distribution certificate and `build/mas.provisionprofile`)

## Publishing to the landing page

The **Build KashFlow Field installers** GitHub Actions workflow packages Windows and universal macOS installers on hosted runners.

The landing page reads the newest published (non-draft, non-prerelease) GitHub release and links any asset whose name matches `KashFlow-Desktop-*-Setup.exe` (Windows) or `KashFlow-Desktop-*.dmg` (macOS). Do not rename those artifacts.

- **Stable release:** push a `v*` tag (for example `v1.2.1`). The workflow publishes a public GitHub release with the installers attached, so the landing page download buttons work immediately.
- **Draft for manual signing:** push a `field-v*` tag to create a draft release instead, for review before publishing.

### Code signing

The workflow signs automatically when the following repository **secrets** are set. Stable `v*` releases stop unless Windows signing, macOS direct signing/notarization, Mac App Store signing, Linux signing, and Snap Store credentials are configured. It verifies the Windows Authenticode signature, direct macOS signature/notarization, MAS app/package signatures, and Linux detached signatures before publishing:

| Platform | Secrets |
|---|---|
| Windows | `WINDOWS_CSC_LINK`, `WINDOWS_CSC_KEY_PASSWORD` |
| macOS direct download | `MACOS_CSC_LINK`, `MACOS_CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` |
| Mac App Store package | `MAC_APP_STORE_CSC_LINK`, `MAC_APP_STORE_CSC_KEY_PASSWORD`, `MAC_APP_STORE_PROVISIONING_PROFILE` (base64-encoded profile). The `.p12` bundle must contain the Apple Distribution and Mac Installer Distribution certificates. |
| Linux AppImage, DEB, and Snap packages | `LINUX_RELEASE_GPG_PRIVATE_KEY`, `LINUX_RELEASE_GPG_PASSPHRASE` |
| Snap Store upload | `SNAPCRAFT_STORE_CREDENTIALS` |

The certificate links accept a base64-encoded certificate or a secure download URL, as expected by `electron-builder`. Without them a manual build logs a warning and the installer is unsigned, which triggers SmartScreen on Windows and Gatekeeper on macOS for your customers. Stable release tags are blocked until all signing material is present and verified.

macOS direct downloads are signed with a Developer ID certificate and notarized when the direct-download secrets are configured. The Mac App Store build is a separate sandboxed `.pkg` target that needs both Apple distribution certificates and a matching provisioning profile; the workflow verifies the `.app` and `.pkg` signatures. Upload the package through Transporter or App Store Connect after creating the listing. The first store listing and the final review submission are manual.

The Windows installer is the signed NSIS `.exe`, which can be submitted through Microsoft's installer submission path after registering the app in Partner Center. The first Partner Center listing and submission setup are manual. On a stable `v*` tag, the workflow uploads the signed Linux Snap package to the Snap Store `candidate` channel; review it there and promote it to `stable` in the store. The generated Snap name defaults to `kashflow`; reserve that name before the first upload, or set `linux.executableName` to the name you registered.

The Linux AppImage, DEB, and Snap files receive detached GPG signatures (`.asc`) from the publisher key and are verified in CI. The public signing key is attached as `Ezz-Prime-Technologies-Linux-signing-key.asc`; publish its fingerprint through a separate trusted channel so users can authenticate the key before importing it. The Snap Store additionally signs uploaded revisions. AppImage and DEB remain direct-download packages.

To create the Snap Store CI credential after registering the package, export a restricted token with `snapcraft export-login --snaps=kashflow --channels=candidate --acls=package_access,package_push,package_update,package_release <file>` and store its contents as `SNAPCRAFT_STORE_CREDENTIALS`. Replace `kashflow` in the command if you configured a different registered name. Do not commit the credential or paste it into chat.

The repository review of data categories, account deletion, and backup retention is in [`docs/store-release-readiness-and-data-retention-review.md`](../../docs/store-release-readiness-and-data-retention-review.md). A public privacy-policy URL and a settled data-retention/deletion decision are still required before store review.
