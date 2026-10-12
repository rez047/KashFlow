# Store release readiness and data retention review

Review date: 2026-10-12
Publisher name supplied: Ezz Prime Technologies
Support email supplied: ezrasimiyu777@gmail.com

## Scope

This is a code and schema review of the repository. No production database, cloud storage bucket, store account, or third-party provider account was accessed. It is an engineering inventory, not a privacy policy or a determination of statutory retention periods.

## Current release targets

| App | Current package/distribution | Signing or store path |
|---|---|---|
| Mobile Android | Expo Android App Bundle; existing APK is for direct testing | EAS production Android signing; store workflow submits to Google Play internal testing |
| Mobile iOS | Expo App Store build | EAS iOS signing; store workflow uploads to App Store Connect/TestFlight |
| Desktop Windows | NSIS `.exe` | Authenticode certificate; stable workflow verifies the signature; Microsoft Store accepts an installer submission after app registration |
| Desktop macOS | Direct `.dmg`/`.zip`, plus a separate MAS `.pkg` build | Developer ID + notarization for direct downloads; Mac App Store signing/profile for MAS; MAS upload is a separate App Store Connect step |
| Desktop Linux | AppImage, DEB, and Snap | Linux package signatures are produced by the configured publisher key; Snap Store signing occurs after upload |
| Web | Hosted Render frontend/API | Not a store package |

The publisher accounts have not been created, and no store signing credentials or public privacy-policy URL have been supplied. Package preparation does not create listings, pass store review, or publish the apps.

## Data stored by the application

- **Account and authentication:** account email, password hash, account/workspace relationships, two-factor encrypted secret, recovery-code hashes, password-reset token hashes, and short-lived login challenges. Session tokens are signed and expire; they are not stored in a session table.
- **Business and accounting records:** workspaces and memberships; customer, supplier, inventory, and project records; invoices, estimates, orders, bills, payments, ledgers, journals, reconciliation data, accounting periods, audit events, tax/payroll runs, and remittances. These records can include names, emails, phone numbers, payment references, descriptions, and financial amounts.
- **Payroll:** employee details and payslips are stored as encrypted database fields; payroll totals and remittance/payment data are also stored as ordinary structured values.
- **Documents:** `workspace_documents` stores each uploaded file's name, MIME type, size, and file bytes (`bytea`) in PostgreSQL, with a 5 MB per-file schema limit.
- **Integrations and communications:** workspace-level integration settings and encrypted credentials exist for some providers; email/SMS/WhatsApp delivery logs, recipients, subjects, provider IDs, and error text are recorded. Bank, M-Pesa, tax, and commerce integration data may also be stored when those integrations are enabled.
- **Mobile device data:** mobile offline inventory snapshots and unsynced counts are stored in a SQLCipher database. Its key and access token are stored in the OS secure store. Sign-out clears local data; account deletion also clears this device after the server confirms deletion.
- **Backups and exports:** when all backup S3 settings are configured and automatic backups are enabled, the API creates full PostgreSQL dumps. A workspace-scoped export is also available from Settings; it is an export, not an erasure operation.

Primary schema references: `api/migrations/001_core.sql`, `003_workspace_access_and_businesses.sql`, `006_accounting_payroll.sql`, `007_operations_documents_settings.sql`, and later migration files. Mobile local-data behavior is in `apps/mobile/app/(tabs)/settings.tsx` and `apps/mobile/src/lib/offline.ts`.

## Account deletion behavior now implemented

- Web/desktop Settings and native mobile Settings offer a self-service account-deletion flow. The API rechecks the current password and requires the user to type `DELETE`.
- The API transaction removes every workspace membership, deletes the user row, and therefore cascades linked authentication data such as two-factor secrets, recovery codes, password-reset tokens, and pending login challenges. Session tokens stop working because API authorization requires a live user and membership row.
- Invitation rows addressed to the deleted account have that email/phone cleared; pending matching invitations are declined.
- Workspace-owned accounting, payroll, documents, integration settings, and existing audit events remain with each workspace. User foreign keys configured with `ON DELETE SET NULL` are cleared. A generic `account.deleted` audit event is added per workspace without the account's email, phone, or user ID.
- Deletion is refused if the person is the sole administrator of an unarchived workspace. The person can archive that workspace after password confirmation; archive makes member writes read-only and disables the public store. It does not delete shared records or choose their retention period. If no other members remain, the records stay stored but user access requires support recovery. A user who wants an active business instead needs an administrator handoff before deletion.
- Existing member removal remains available for individual non-admin members. This is separate from a user's self-service deletion request.

Relevant implementation: account deletion and workspace archive routes in `api/src/server.ts`, archive migration `api/migrations/035_workspace_archive.sql`, and the web/mobile Settings account-deletion interfaces.

## Retention and erasure gaps found

- The code defines no general retention schedule for business records, audit events, messages, or provider logs.
- Login challenges, password-reset requests, invitations, and public invoice links have `expires_at` values checked when used, but no periodic purge job was found. Expired rows may remain until account/workspace deletion or another cleanup.
- Hourly S3 backups use one object per UTC hour and are overwritten on the next backup for that hour. The backup listing path prunes entries beyond 24, but the `retentionhours` metadata alone is not a bucket expiry rule.
- A pre-restore safety dump is written to the fixed key `database-safety/pre-restore.dump`; the code does not expire or delete it. It is replaced only by a later pre-restore backup.
- Deleting a live database row does not rewrite existing full-database backups. A deletion policy needs to state when backup copies age out and whether a pre-restore safety copy is included.
- Provider, hosting, email/SMS, and app-store retention periods cannot be established from this repository; they need review against the accounts and contracts actually selected.

Backup implementation: `api/src/operations/databaseBackups.ts`; scheduler and restore behavior: `api/src/server.ts`.

## Retention decisions still required before public release

1. **Accounting, payroll, and tax records:** a qualified review must set required retention windows before we promise a final deletion date or erase shared records.
2. **Backups:** choose a backup-expiry window and define whether deletion is complete after live authentication data is removed or only after retained snapshots expire. The fixed pre-restore safety key needs an expiry/cleanup rule too.
3. **Expired authentication and invitation rows:** choose purge intervals and add scheduled cleanup if those rows are to be deleted on a timetable.
4. **Archived workspaces:** choose how long records remain after archive, how a memberless archived workspace can be exported/restored, and who can authorize that recovery.

## Store-facing blockers

- A public privacy-policy URL has not been supplied; none was found in the repository.
- Account deletion can now be initiated from web/desktop and native mobile Settings. Store listings still need a public deletion-request destination/disclosure, and the retention and backup schedule must be decided before public review.
- The mobile Business area relies substantially on a hosted WebView; Apple may review whether the native app provides sufficient functionality beyond the website.
- Publisher accounts/listings and signing credentials must be created before store submissions can be made. Store metadata should use the supplied publisher name and support email, then disclose the data categories above accurately.
