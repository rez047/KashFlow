# Store publisher setup

Publisher details provided for store listings:

- Publisher: **Ezz Prime Technologies**
- Support: **ezrasimiyu777@gmail.com**
- Publisher/store accounts: **not yet set up**
- Public privacy-policy URL: **not provided**

The current product identifiers are Android/iOS `ke.kashflow.inventory`, Windows/macOS `ke.kashflow.desktop`, and the Linux Snap defaults to the name `kashflow`. Reserve that name in Snapcraft before the first upload; if unavailable, change `linux.executableName` to the name that is registered.

## Before creating public listings

1. Complete the [data-retention review](store-release-readiness-and-data-retention-review.md) and set retention and expiry rules for shared business records, archived workspaces, and backups. Account deletion now removes authentication/access while preserving shared workspace records.
2. Publish a privacy policy at a stable public URL. It should be based on the actual service providers and retention decisions, rather than copied from a generic template.
3. Prepare store descriptions, screenshots, age/content ratings, support links, and an accurate data disclosure for the account, business, payroll, document, integration, and device data described in the review.
4. Create publisher accounts under the correct legal organization details. Account identity, payment, tax, and terms acceptance are account-owner steps.

## Accounts and first submissions

| Platform | Account and first setup | Release path in this repository |
|---|---|---|
| Google Play | Create a Play Console publisher account and an app listing for `ke.kashflow.inventory`. Configure the Play service account and Android signing credentials in the linked EAS project. | **Build and upload mobile store test releases** sends the production-signed AAB to the Play internal track. Production rollout and review are done in Play Console. |
| Apple App Store | Join the Apple Developer Program, register the bundle ID, create an App Store Connect app record, and configure the API key and iOS distribution credentials in EAS. | The mobile workflow uploads the signed build to TestFlight. App Review submission and release are done in App Store Connect. |
| Microsoft Store | Create a Partner Center account, reserve the app name, complete the initial app submission, and configure the listing. The signed NSIS EXE can use Microsoft's installer submission path. | The desktop workflow creates and verifies the signed `.exe`; first listing/submission setup is in Partner Center. Microsoft's API can automate later MSI/EXE submissions after the app has been created and initially submitted. |
| Mac App Store | Create the Mac app record, App ID, distribution certificate(s), and provisioning profile. The MAS certificate bundle must include Apple Distribution and Mac Installer Distribution identities. | The desktop workflow builds and verifies a sandboxed `.pkg`; upload it with Apple's Transporter, then choose the build and submit the listing in App Store Connect. |
| Snap Store | Create a Snapcraft account and register the final Snap name. Export a restricted Snap Store login credential for CI. | A stable desktop tag uploads the signed Snap to the `candidate` channel. Promote it to `stable` in Snapcraft after review. |
| Linux direct downloads | Create a publisher GPG signing key and publish its fingerprint through a trusted channel. | Linux AppImage, DEB, and Snap assets get detached GPG signatures; the Snap also receives the Snap Store's signature after upload. |
| Web | No store account; configure the existing Render service. | The frontend and API are deployed to Render. |

Microsoft's MSI/EXE submission API requires the app to have a Partner Center listing and an initial manual submission before later API submissions can be automated. See [Microsoft's submission API prerequisites](https://learn.microsoft.com/en-us/windows/apps/publish/store-submission-api).

## GitHub configuration

Repository variables:

- `EXPO_PROJECT_ID`: EAS project UUID; the workflow injects this into `extra.eas.projectId` at CI time.
- `IOS_ASC_APP_ID` and `APPLE_TEAM_ID`: required for iOS/TestFlight uploads.

Repository secrets and EAS credentials are listed in [the desktop setup](../apps/desktop/README.md#code-signing) and [the mobile setup](../apps/mobile/README.md#store-testing-releases). Store private keys and certificates belong in GitHub Secrets or EAS credentials; never commit them or send them in chat.

## Public review blockers

- Account deletion is available in native mobile Settings and web/desktop Settings. Publish a public deletion-request destination and store disclosures that point users to the in-app flow; complete the separate retention and backup-expiry review before public release.
- No privacy-policy URL is available. Apple requires a privacy-policy URL and app privacy answers; Google Play requires the privacy-policy and Data safety disclosures.
- The mobile Business tab primarily uses a hosted WebView. Apple's minimum-functionality rule may lead to review scrutiny; the existing native inventory/count features need a reviewer-ready explanation.
- Store signatures establish who signed a package and whether it changed. They do not mean the store has approved the listing or guarantees a verification badge.

Official review references: [Apple account deletion](https://developer.apple.com/support/offering-account-deletion-in-your-app/), [Google Play account deletion](https://support.google.com/googleplay/android-developer/answer/13327111?hl=en), [Apple app privacy](https://developer.apple.com/help/app-store-connect/reference/app-privacy/), and [Google Play Data safety](https://support.google.com/googleplay/android-developer/answer/10787469?hl=en).

If the Play publisher account is a personal account created after 2023-11-13, Google currently requires a closed test with at least 12 opted-in testers for 14 continuous days before applying for production access. Confirm the account-type-specific requirements in Play Console before scheduling launch: [Google's testing requirement](https://support.google.com/googleplay/android-developer/answer/14151465?hl=en).
