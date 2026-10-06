# KashFlow

KashFlow is a Kenyan-first, cloud-hosted business finance workspace built with React, TypeScript, Vite, Express, and PostgreSQL. It is intended to help small businesses keep basic financial records in one place. It is an early MVP, **not a feature-complete QuickBooks Advanced replacement** and not yet production-ready for regulated accounting, payroll, or statutory filing.

## What it currently does

- Lets each new business owner self-register a separate workspace and administrator account from the homepage using a business name, email or phone number, and a password of at least 12 characters. Reusing an existing email/phone requires signing in.
- Provides password sign-in, signed HttpOnly session cookies, and sign-out.
- Lets a signed-in user create additional businesses/workspaces and switch to the newly created business.
- Saves manual income/expense records and internal invoice records to PostgreSQL.
- Provides workspace-scoped customer, supplier, inventory, and project records, plus private document upload/download/delete (5 MB maximum per file).
- Links suppliers to multiple optional inventory items they provide, creates invoices directly from saved customer records, and lets POS staff choose between walk-in and named remote customers.
- Supports reviewed CSV bank-statement import and balanced journal posting, and a Mono-backed bank connection/sync/review path when Mono business approval and server API keys are configured. Mono coverage lists Kenya; verify target banks in the Mono dashboard. Feed data is imported for review and is not auto-posted into accounting.
- Provides workspace-scoped, self-reported onboarding milestone tracking for eTIMS, bank feeds, and statutory filing; milestones do not assert verified certification.
- Saves eTIMS invoice and payroll statutory-preparation drafts. The **Submit to authority** action uses the implemented KRA OSCU adapter for validated fiscal payloads when the device is initialized; live production remains kill-switched pending KRA certification/approval. Statutory submissions remain blocked pending an authorized return adapter.
- Implements KRA OSCU sandbox/production HTTP calls for device initialization, code-list retrieval, and sales fiscalization. Taxpayer/device/CMC-key material is AES-256-GCM encrypted using a dedicated API-side key. Production is default-disabled and requires an explicit server kill switch, initialized KRA device, certification evidence, and a validated fiscal payload. An accepted KRA response is recorded distinctly from invoice payment.
- Provides business report charts for recorded income and expenses and a preview/printable internal invoice.
- Can send invoice email through Resend when a server-side API key and verified sender are configured; accepted messages are audited, but delivery to the recipient is not guaranteed.
- Shows saved transactions, customizable Overview totals for today, last week, last 30 days, month to date, year to date, or a custom date range (month to date by default), a daily cash-flow chart, and unpaid invoice totals.
- Can initiate a Safaricom Daraja M-Pesa STK Push for a whole-KSh unpaid invoice when merchant credentials and a public callback URL are configured; it verifies the callback with Daraja's STK Query API before marking the invoice paid.
- Provides a versioned Kenya payroll estimator for PAYE, employee/employer NSSF, SHIF, and Affordable Housing Levy, with explicit assumptions and review warnings.
- Provides editable, encrypted employee records (including optional bank details) and payslips. Payroll drafts let admins include/remove active employees, enter per-employee bonuses, and review employee-level salary, estimated taxes, deductions, and net pay before posting. Confirmed external payroll payments are recorded as a separate `Payroll` expense and reduce payroll payable; bank feeds remain read-only, no bank payout is initiated, and any unpaid balance stays payable. Statutory remittances are reference tracking only.
- Seeds a per-business chart of accounts; posts balanced journal entries for manual transactions, invoices, and posted payroll; exposes a trial balance and journal history. Posted journals stay immutable and can be corrected through a linked reversal in an open period plus a separately posted replacement entry.
- Provides date-ranged income statement and as-of balance sheet management reports calculated from posted journals. These are operational reports only, depend on correct opening balances/account mappings, and are not audited or tax-certified financial statements.
- Supports multi-line invoices and estimates, optional inventory-item links, partial invoice payments, accepted estimate-to-invoice conversion, supplier bills with partial payments and optional approval, and manual bank reconciliation against posted ledger transactions.
- Tracks inventory movements, weighted-average item costs, per-location balances, inter-location transfers, stock counts, purchase orders and receipts; invoiced stock is deducted and cost of goods sold is posted in the same database transaction. Admins can record damaged or expired stock write-offs, which deduct inventory and post its recorded cost as an expense, and configure business-level low and medium stock thresholds to group items into low, medium, and healthy levels. Stock shortages are rejected; item reorder points can raise low and medium alert cutoffs.
- Provides a counter POS checkout from saved inventory, SKU/barcode keyboard-wedge scanning, location-aware availability, saved-customer selection and quick-add for walk-in or remote sales, customer sale-history/lifetime-sales snapshots, quantity/stock controls, KSh totals, internal printable receipts, and cash-payment recording. Customer history is matched by saved email or legacy invoice name; this is a loyalty overview only, with no points earned or redeemed. Cached workspace inventory enables local-only cash sale drafts while offline; drafts must sync online and pass current stock validation before becoming invoices. No offline payment is confirmed or inventory reserved. Optional M-Pesa checkout requests use the configured Daraja STK Push path; M-Pesa is unavailable offline. POS sales use the existing invoice/inventory ledger and are not eTIMS fiscal receipts.
- Supports accepted-estimate-to-sales-order progression, order fulfillment/cancellation, invoice conversion after fulfillment, and partial invoice returns with credit/refund ledger records and optional restocking. A recorded refund is not a money transfer.
- Provides retail management insights for stock valuation, reorder-point alerts, location stock, best-selling products, and estimated gross profit; values are bookkeeping estimates, not audited valuation.
- Offers a Windows local ESC/POS bridge for compatible network receipt printers and cash drawers. Browser printing remains available; physical printing requires separately configured hardware and a bridge running on the checkout computer. Both produce internal receipts, not eTIMS tax invoices.
- Provides a simple hosted product catalog, customer order-request and secure order-tracking pages, seller review, invoice conversion, and fulfillment tracking. These flows do not take customer payments.
- Supports encrypted WooCommerce REST API credentials, product synchronization, and importing orders for seller review. WooCommerce payment status is never treated as proof of payment.
- Provides a language selector with English, Kiswahili, French, Arabic, Somali, Amharic, and Portuguese phrase catalogs for shared navigation and key storefront/POS text. Untranslated text falls back to English; this is not yet a complete translation of every screen.
- Lets admins configure business-area permissions for team members; administrators retain full access and server-side route enforcement is required for every write path.
- Supports project time entry and review with budget and billable-margin estimates, recurring invoice/expense schedules with deliberate manual execution, account budgets, receivables/payables aging, and a historical-average cash-flow estimate. Project billable values are estimates from approved hours, not actual invoiced revenue or realized profit.
- Supports accounting period close and reopen, with posting blocked in closed periods.
- Lets administrators invite team members using built-in or custom business roles, create/tune custom permission sets, and assign roles or inherited/custom permission overrides to members. Administrators retain full access; permission enforcement still requires a full authorization review before production.
- Uses Kenyan Shillings (KSh) in the finance UI and describes the intended local compliance integrations transparently.
- Optionally creates a full PostgreSQL logical backup every hour to private S3-compatible object storage, retaining 24 UTC hourly slots, when the API operator configures S3 credentials, an operator token, `DATABASE_URL`, and PostgreSQL dump/restore tools. Restore is platform-wide, requires operator authorization and exact confirmation, writes a pre-restore safety backup, and should be done during planned downtime.

## Important implementation and readiness limits

Do not treat UI labels, environment variables, or saved invitation records as working third-party integrations. The current repository does **not** include:

- Automatic employee payments, bank-feed payment verification, statutory remittance transfers, or filing/submission to KRA, SHIF/SHA, NSSF, or AHL. Connected bank feeds are read-only and require review; payroll payments are recorded only after an external payment is confirmed and entered with its reference. Remittances are only tracked after an external payment is made; payroll formula rules require professional review.
- Production-grade journal edits/reversals, audit certification, scheduled reminders, robust statement-line matching/exceptions, and period-end review controls. Invoice reminders are sent manually when Resend is configured; customer invoice links are read-only and expire after 30 days. Reconciliation currently matches existing posted ledger transactions; it does not reconcile unposted provider-feed entries in a review queue.
- Automatic recurring posting (each due schedule is run manually), automated reorder purchasing, payroll-to-project costing, and comprehensive production-grade security/permission administration. Inventory valuation and project time/cost tracking are operational bookkeeping tools and require review.
- Statutory filing/remittance integrations for PAYE, AHL, SHIF, and NSSF. Saved payroll summaries and review attestations do not submit authority returns.
- Comprehensive role-based authorization across every endpoint, MFA, automated backup/restore/key rotation, and a general-purpose audited per-business integration-credential vault. WooCommerce credentials have a dedicated encrypted store; other provider integrations still require individual security review and controls before production use.

Administrators and authorized workspace writers can preview and import up to 500 customer, supplier, inventory, or project rows from CSV under **Settings → Import records from CSV**; duplicate names are skipped, and inventory opening stock is recorded in stock movements and the ledger. Admins can download business-scoped CSV exports for customers, suppliers, inventory, projects, invoices, bills, ledger transactions, journals, and supported audit events under **Settings → Export workspace data**. These are exports, not full database backups or a complete accounting-system restore. POS invoice creation accepts a checkout idempotency key so a retried request does not create another invoice or deduct stock twice. No offline invoice queue is implied.

BiasharaBooks feature comparison: its [public feature page](https://biasharabooks.com/#features) advertises inventory, POS, purchasing and sales documents, reports, team permissions, WooCommerce, and an online store/client portal. KashFlow supports multi-location stock, internal transfers/counts, keyboard-wedge SKU/barcode scanning, returns/credits, sales-order progression, retail reports, optional ESC/POS hardware through a local bridge, order-request storefronts, WooCommerce sync, initial multilingual catalogs, and configurable area permissions. These additions do not make KashFlow a complete retail platform: language coverage is partial, external payments are not taken by the storefront, integration readiness is not implied, and route-level authorization remains incomplete. Receipts remain internal and are not certified fiscal receipts.

### Optional local POS printer bridge

For a compatible ESC/POS network printer, copy `pos-bridge/.env.example` to `pos-bridge/.env`, configure `POS_PRINTER_HOST`, `POS_PRINTER_PORT`, and `POS_ALLOWED_ORIGIN` to the exact KashFlow frontend origin, then run `pos-bridge/start.cmd` on the Windows checkout computer. The bridge binds only to localhost; the POS page can test it and send the latest recorded receipt. Connect a cash drawer to a compatible printer and use the drawer control only after recording cash payment. Keep the bridge's `.env` local and private. Physical hardware compatibility varies; this setup does not provide USB/Bluetooth printer support or a KRA fiscalization path.

### Online store and WooCommerce setup

Admins configure the hosted store under **Settings → Online store and customer orders**. Publish only inventory records with an appropriate selling price. The checkout creates an order request, not a payment; accept it after confirming stock and terms, then convert it to an internal invoice. WooCommerce requires HTTPS and the API-side `ONLINE_COMMERCE_ENCRYPTION_KEY` (a stable, separate random key of at least 32 characters). Generate read/write REST API credentials in WooCommerce, enter them only in KashFlow's admin settings form, and run product/order synchronization explicitly. Imported orders remain pending review; verify prices, shipping, taxes, and payment independently. Back up the encryption key securely.

Mono bank feeds have an implementation path and are enabled only after Mono business/KYB onboarding and `MONO_PUBLIC_KEY`/`MONO_SECRET_KEY` are configured on the API service. Users link via Mono-hosted consent. Mono's listed Kenya coverage does not guarantee every Kenyan bank is available to a particular Mono app/account. Webhook secret verification and scheduled sync import feed entries for review; posting to the ledger requires a separate user review. KRA OSCU now has a documented direct API client for device initialization, current code retrieval, and sale submissions. This is **not KRA-certified software** and is not production-enabled by default: test it only with approved KRA sandbox credentials. Before production, complete taxpayer/device registration, OSCU certification, and KRA production approval; configure `KRA_ETIMS_ENV=production`, the KRA-issued credential encryption key, and then deliberately enable `KRA_ETIMS_LIVE_ENABLED=true` in the API service. User-entered certification references are not independently verified by KashFlow. The invoice-to-fiscal-data mapping remains explicit and must be reviewed against current KRA codes/tax treatment before any submission. Network timeout after submit is treated as indeterminate and must be reconciled with KRA before retrying to avoid duplicates.

Statutory PAYE/AHL/SHIF/NSSF filing is still **not implemented as an authority adapter**. KRA's public PAYE guidance specifies the iTax return-workbook validation/upload workflow; this app has no published or authorized machine-to-machine endpoint, official return template, or approved filing credentials. SHIF/SHA, NSSF and AHL routes also require confirmation from each authority or an authorized provider. We will not automate portal login/password scraping or claim these are filed. Supply the official authorized API/partner contract, sandbox credentials and qualified reviewed return mapping before implementing a submission adapter. Payroll calculations remain estimates.

## Simple step-by-step: what it takes to make integrations live

This checklist uses plain language and real provider-issued credentials only. **Do not enter made-up values.** Turning on a switch in Business settings or adding secrets in Render does not, by itself, make a provider connection safe or live.

### Before you start: understand the current limit

- Render environment variables belong to the whole API service. In the current app, Daraja and Mono credentials are shared by all workspaces using that service; they are not per-user credentials.
- The API now checks workspace administrator membership and the saved business opt-in for M-Pesa payment initiation and Mono link/manual sync. Scheduled and webhook-triggered Mono syncs skip businesses that have opted out. Production KRA device operations and submissions also check the workspace opt-in. These controls do not make credentials per-business: Daraja and Mono credentials in Render remain shared by every workspace, so do not use one shared merchant/provider account for unrelated businesses without explicit provider authorization and separate tenant-level credential handling.
- KRA OSCU has API code, but this app is not KRA-certified. Only use production after KRA has approved the taxpayer/device/software and the fiscal invoice mapping has been professionally checked.
- PAYE, AHL, SHIF/SHA, and NSSF filing adapters are not implemented. No Render variable can make those filings live today. Payroll figures are estimates, and remittance references are manual records only.

### Step 1 — Deploy the app with its database

1. Deploy the Render Blueprint using the instructions in **Deploy to Render (Blueprint)** below.
2. In the Render **API service → Environment** page, confirm `DATABASE_URL`, `SESSION_SECRET`, `PAYROLL_DATA_ENCRYPTION_KEY`, and `FRONTEND_ORIGIN` are set. Render generates secrets for some Blueprint values; keep them private and do not replace encryption keys after saving real data without a planned key migration.
3. In the **frontend static site → Environment** page, set `VITE_API_BASE_URL` to the API's public HTTPS address. This is an address, not a secret.
4. Deploy both services. Open the site, create the business administrator, and test sign-in, adding a transaction, and creating an internal invoice. These app features do not require a provider integration.

### Step 2 — Pick one provider and complete its onboarding

Use the provider's official dashboard and obtain credentials issued to your organization. Do not borrow credentials from another business.

- **Daraja / M-Pesa:** Complete Safaricom merchant and Daraja app onboarding. For testing, obtain sandbox credentials. For real payments, obtain production approval, shortcode, passkey, and production app credentials.
- **Mono bank feeds:** Complete Mono partner/business onboarding and KYB, obtain the app keys, and confirm the business's bank is supported. A bank user must still approve access in Mono's consent flow.
- **KRA eTIMS:** Register the taxpayer/device, complete KRA sandbox tests and the applicable software certification/production approval. Have a qualified tax professional verify the fiscal invoice fields and tax mapping. Self-entered approval references are not independently verified by this app.
- **Email (optional):** Verify a sending domain with Resend and create an API key.

### Step 3 — Put that provider's values in Render (API service only)

In Render, open **API service → Environment**, add the relevant variables below using the exact values from the provider, save, and redeploy the API. Never put secret values in the frontend or in this README.

- **Daraja:** `MPESA_ENV=sandbox`, `MPESA_CONSUMER_KEY`, `MPESA_CONSUMER_SECRET`, `MPESA_SHORTCODE`, `MPESA_PASSKEY`, and `MPESA_CALLBACK_URL`. Set the callback to the exact public API address shown by Render, followed by `/v1/integrations/mpesa/callback`. Use production mode and live credentials only after Safaricom approval; the callback must be HTTPS. `MPESA_TRANSACTION_TYPE` is optional and must match the merchant account.
- **Mono:** `MONO_PUBLIC_KEY`, `MONO_SECRET_KEY`, and a strong `MONO_WEBHOOK_SECRET`. Configure Mono's webhook destination using the exact public API address shown by Render, followed by `/v1/integrations/mono/webhook`. The secret key and webhook secret stay on the API.
- **KRA sandbox:** `KRA_ETIMS_ENV=sandbox` and `KRA_ETIMS_CREDENTIALS_ENCRYPTION_KEY` (a separate, stable random secret of at least 32 characters). Save the taxpayer/device credentials in the Kenya compliance page and initialize the device only with KRA-approved sandbox credentials.
- **KRA production:** Only after KRA has approved production, change to `KRA_ETIMS_ENV=production` and set `KRA_ETIMS_LIVE_ENABLED=true`; keep the encryption key configured and use the approved production taxpayer/device credentials. The server kill switch is a final operator gate, not a substitute for certification or workspace access checks.
- **Resend email:** `RESEND_API_KEY` and `EMAIL_FROM`, with `EMAIL_FROM` matching a sender/domain verified by Resend.

### Step 4 — Test without risking real money or tax filings

1. Start with provider sandbox/test credentials wherever the provider offers them. Keep KRA in sandbox and Daraja in sandbox during development.
2. Test a complete flow with your own authorized test account: consent or payment request, provider callback/webhook, status verification, and resulting records in the correct business workspace.
3. Confirm failed, duplicate, delayed, and cancelled callbacks do not falsely mark a payment or invoice complete. Check provider dashboards as well as KashFlow; a green UI label alone is not proof of success.
4. For KRA, reconcile every sandbox response with the KRA test environment. Do not treat a sandbox receipt as a fiscal invoice.
5. Before production, have the relevant provider, qualified reviewer, and business owner approve the cutover. Test a small controlled transaction where applicable and reconcile it against the provider's own records.

### Step 5 — Do not mistake workspace preferences for per-business credentials

Workspace provider switches are enforced for the currently implemented live-provider actions, and provider mutations require a workspace administrator. However, Render credentials are still API-service-wide, rather than isolated per business. Separate provider accounts/credentials require a supported provider arrangement and an encrypted, audited tenant credential store; do not use a shared credential for unrelated businesses' live money movement or compliance submissions unless the provider contract expressly permits it and the tenant controls have been independently reviewed and tested.

### What cannot be switched on yet

- **Statutory submissions:** PAYE, AHL, SHIF/SHA, and NSSF need approved authority/provider routes, implemented adapters, official formats, credentials, qualified review, and end-to-end tests. These are not available by setting environment variables.
- **Per-business live provider credentials:** Not supported for Daraja or Mono by the current shared Render environment configuration. The workspace toggles alone do not provide this.
- **Certified KRA production service:** The app's OSCU client is not itself proof of KRA certification. Production use must wait for KRA's explicit approvals and completion of the workspace authorization and operational safeguards above.

## Deploy to Render (Blueprint)

The repository includes [render.yaml](render.yaml), which describes a static frontend, Node API, and managed PostgreSQL database. The Blueprint uses the named service URLs `https://kashflow-frontend.onrender.com` and `https://kashflow-api.onrender.com` to avoid circular service references. Check the actual URLs after provisioning and update `FRONTEND_ORIGIN`/`VITE_API_BASE_URL` if Render assigns different URLs. The Blueprint generates both `SESSION_SECRET` and `PAYROLL_DATA_ENCRYPTION_KEY`; preserve the payroll key across deployments and securely back it up.

1. Push this repository to GitHub and sign in to [Render](https://render.com/).
2. In Render, choose **New → Blueprint**, connect the GitHub repository `rez047/KashFlow`, and select the `main` branch.
3. Review the Blueprint resources before applying: `kashflow-api` (Node web service), `kashflow-frontend` (static site), and `kashflow-db` (PostgreSQL). Confirm the database plan, region, cost, and retention meet your needs; the configured database plan may incur charges.
4. Apply the Blueprint and wait for the database and services to provision. The API runs `npm ci && npm run build`, starts with `npm start`, and checks `/healthz`. The static site builds with `npm ci && npm run build` and publishes `dist`.
5. In the API service's **Environment** settings, confirm these values:
   - `NODE_ENV=production`
   - `DATABASE_URL` is linked to the Render PostgreSQL connection string.
   - `SESSION_SECRET` is a Render-generated secret with at least 32 characters. Keep it private; rotating it signs out existing sessions.
   - `PAYROLL_DATA_ENCRYPTION_KEY` is generated as an independent server-side secret, minimum 32 characters. Never put it in the static frontend. Losing it makes encrypted payroll records unreadable; establish a backup and rotation procedure.
   - For WooCommerce only, optionally set `ONLINE_COMMERCE_ENCRYPTION_KEY` to a separate stable server-side random secret of at least 32 characters. Back it up securely; it encrypts REST API credentials and is not a frontend variable.
   - `FRONTEND_ORIGIN` is the exact HTTPS origin of the deployed frontend, with no path or trailing slash (for example, `https://kashflow-frontend.onrender.com`).
6. In the frontend static site's **Environment** settings, confirm `VITE_API_BASE_URL` is the exact HTTPS base URL of the API (for example, `https://kashflow-api.onrender.com`), with no path. Because `VITE_*` values are included in the public browser bundle, never put secrets there.
7. Save environment changes and redeploy both services. If Render generated URLs different from the example, update both sides: set API `FRONTEND_ORIGIN` to the frontend's actual origin and frontend `VITE_API_BASE_URL` to the API's actual URL, then redeploy.
8. Check `https://<your-api-host>/healthz` returns `{"status":"ok","database":"available"}`. Check the frontend URL loads, create the first admin account, and verify sign-in, sign-out, business creation, and manual record entry.
9. Keep Render's generated `PAYROLL_DATA_ENCRYPTION_KEY` stable and securely backed up. If changing it, first implement/execute a decrypt-and-re-encrypt rotation; replacing it directly strands existing encrypted employee/payslip rows.
10. Before production data: configure and test database backups/restore, access and security policies, monitoring/alerts, privacy notices, domain/TLS settings, and incident recovery. Backup tooling is optional and disabled until all S3, token, database, and PostgreSQL tool settings are configured. The app does not provide invitation email delivery.
11. Optional M-Pesa setup: complete Daraja merchant/app onboarding, add every `MPESA_*` value in the API service environment, set the callback to `https://<your-api-host>/v1/integrations/mpesa/callback`, redeploy the API, then test with sandbox credentials and a Safaricom-reachable HTTPS callback before considering production mode.
12. Optional invoice email: verify a sending domain in Resend, create an API key, set `RESEND_API_KEY` and `EMAIL_FROM` in the API service environment, then redeploy. Send a test invoice to an address you control and inspect Resend logs. Never add either value to the frontend or source control.

### Render deployment troubleshooting

- **CORS/request-origin errors:** `FRONTEND_ORIGIN` must match the browser origin exactly, including `https://`, and the API must be redeployed after changing it.
- **API unreachable:** verify `VITE_API_BASE_URL` points to the API service, not the static frontend; redeploy the static site after changing it.
- **Database unavailable:** verify the `DATABASE_URL` reference points to the provisioned database and that database/service regions and access are correct.
- **No first-account setup:** setup is enabled only when the database has no users. Do not delete production users just to re-enable bootstrap.
- **Render free instances:** may sleep or have other limits depending on current Render plans; review Render's current pricing, persistence, and database backup terms before selecting a plan.

## Required environment variables

These are the variables used by the **current code**. The Blueprint sets or links the core deployment variables. M-Pesa variables are optional for the application, but all listed Daraja credentials and a callback URL are required to initiate STK Push.

| Name | Where | Required | Value / purpose |
|---|---|---:|---|
| `NODE_ENV` | API | Yes in production | Set to `production`; selects secure cookie and production configuration behavior. |
| `PORT` | API | Render supplies it | HTTP listening port. Local default is `3001`; normally do not set manually on Render. |
| `FRONTEND_ORIGIN` | API | Yes | Exact frontend HTTPS origin allowed by CORS and write-origin checks. |
| `DATABASE_URL` | API | Yes in production | PostgreSQL connection URL; linked from the Render database resource. |
| `SESSION_SECRET` | API | Yes in production | Random secret, minimum 32 characters, used to sign sessions. Generate in Render; never commit or expose to the frontend. |
| `PAYROLL_DATA_ENCRYPTION_KEY` | API | Yes in production | Independent random secret, minimum 32 characters, used for AES-256-GCM encryption of employee and payslip fields. Back up securely; without this exact key records cannot be decrypted. |
| `ONLINE_COMMERCE_ENCRYPTION_KEY` | API | Optional for WooCommerce | Separate stable random secret, minimum 32 characters, used to encrypt WooCommerce REST credentials. Back up securely; changing it makes saved credentials unreadable. |
| `VITE_API_BASE_URL` | Static site build | Yes | Public base URL for the API; not a secret. Vite embeds it in the browser build. |
| `MPESA_ENV` | API | Optional | `sandbox` (default) or `production`. Do not select production until Safaricom has approved and provided live merchant details. |
| `MPESA_CONSUMER_KEY` | API | Required for STK Push | Daraja app consumer key. Server-side configuration only. |
| `MPESA_CONSUMER_SECRET` | API | Required for STK Push | Daraja app consumer secret. Keep private. |
| `MPESA_SHORTCODE` | API | Required for STK Push | PayBill/Till shortcode enabled for the selected STK transaction type. |
| `MPESA_PASSKEY` | API | Required for STK Push | Daraja STK Push passkey for that shortcode. Keep private. |
| `MPESA_CALLBACK_URL` | API | Required for STK Push | Public callback URL ending `/v1/integrations/mpesa/callback`; production must use HTTPS and be reachable by Safaricom. |
| `MPESA_TRANSACTION_TYPE` | API | Optional | `CustomerPayBillOnline` (default) or `CustomerBuyGoodsOnline`, according to merchant configuration. |
| `RESEND_API_KEY` | API | Optional for invoice email | Resend server API key. Keep it private and configure only after creating a Resend account. |
| `EMAIL_FROM` | API | Required with `RESEND_API_KEY` | Sender address/domain verified in Resend (for example `billing@yourdomain.co.ke`). |
| `MONO_PUBLIC_KEY` | API response to authenticated frontend | Optional for bank feeds | Mono app public key; returned by the server only when the Mono adapter is configured. |
| `MONO_SECRET_KEY` | API | Required for bank feeds | Mono secret API key; never expose it in the browser or any `VITE_*` setting. |
| `MONO_WEBHOOK_SECRET` | API | Recommended for event-driven account refresh | Shared webhook secret configured on the Mono app; callback URL is `https://<your-api-host>/v1/integrations/mono/webhook`. |
| `MONO_SYNC_INTERVAL_MINUTES` | API | Optional | Connected account polling interval in minutes (15–1440; default 60). A single API instance is recommended for the in-process scheduler. |
| `KRA_ETIMS_ENV` | API | Optional | `sandbox` (default) or `production`; select production only after KRA approves the OSCU device and integration. |
| `KRA_ETIMS_LIVE_ENABLED` | API | Required for production sends | Explicit kill switch, default `false`. Set `true` only after KRA production certification and approval. |
| `KRA_ETIMS_CREDENTIALS_ENCRYPTION_KEY` | API | Required to save OSCU device credentials | Independent stable 32+ character secret for AES-256-GCM encrypted taxpayer PIN, device serial, and KRA communication key. Back it up securely; never put it in Vite/frontend variables. |

Payroll estimation is available through the authenticated `POST /v1/payroll/kenya/estimate` endpoint and Payroll screen. Rule set `KE-2026-01` (snapshot effective `2026-02-01`) uses employee/employer NSSF at 6% of pensionable earnings, capped at KSh 108,000; the KSh 9,000 lower earnings limit defines Tier I and is included in the contribution base. Other snapshot parameters are employee SHIF at 2.75% with a KSh 300 minimum when gross pay is positive; employee/employer Housing Levy at 1.5% each; monthly resident PAYE bands of 10% on the first KSh 24,000, 25% on the next KSh 8,333, 30% on the next KSh 467,667, 32.5% on the next KSh 300,000, and 35% thereafter; and monthly personal relief up to KSh 2,400. These values are a code snapshot, not auto-updated legal rules. Payroll runs persist employee and payslip fields encrypted with `PAYROLL_DATA_ENCRYPTION_KEY`. Before relying on results, check current official guidance and obtain qualified review. Remittance references are tracked manually; no statutory payments or filing are performed.

No first-admin email/password is provided or required: the first user chooses these from the homepage. The API also uses local defaults for `NODE_ENV`, `PORT`, and `FRONTEND_ORIGIN` during development; production must have the required values above. For local development, copy [api/.env.example](api/.env.example) to `api/.env`, set `DATABASE_URL` and a random `SESSION_SECRET`, then copy [.env.example](.env.example) to `.env.local` and set `VITE_API_BASE_URL=http://localhost:3001`. The development-only in-memory `pg-mem` fallback loses data when the API restarts; do not use it for deployment.

### Other provider-specific variables (not implemented)

The application has Resend invoice email and an optional Mono financial-data adapter. Mono requires partner dashboard registration, business/KYB approval, app keys, funded live API account, and checking institution coverage. KRA offers OSCU for always-online invoicing systems and VSCU for bulk invoicing that may not always be online. KRA's published path requires development, testing, vetting, and certification for self-integrators or software vendors. The taxpayer must be registered on eTIMS and choose OSCU/VSCU. Obtain KRA's specifications, register in its sandbox, complete required test cases, submit vendor/taxpayer information and supporting documents, pass vetting, and receive certification before issuing fiscal invoices. Begin at the [official eTIMS system-to-system integration page](https://www.kra.go.ke/business/etims-electronic-tax-invoice-management-system/learn-about-etims/etims-system-to-system-integration) and [eTIMS onboarding guide](https://www.kra.go.ke/business/etims-electronic-tax-invoice-management-system/learn-about-etims/how-to-onboard-on-etims). KRA's published PAYE process uses iTax: employers with a PAYE obligation download/complete and validate the official return workbook, upload the generated return package, and receive an acknowledgment; filing and payment are due by the 9th of the following month. This repository does not have an authorized statutory-return submission API or official current return templates. For SHIF/SHA, NSSF, and AHL, obtain the employer registration and submission route from each authority and any authorized provider in writing. Before implementing submission, obtain qualified Kenyan payroll/tax approval of the current rates, employee data mapping, return formats, error handling, payment references, and reconciliation. Never put secrets in `VITE_*`, source control, chat, or README values. Configure secrets only in server-side Render settings or an approved encrypted vault.

The Kenya Compliance page now records the selected OSCU/VSCU solution, taxpayer PIN, sandbox/certification/production approval references, and separate PAYE/AHL/SHIF/NSSF filing-route declarations. It also records the statutory provider and route confirmation reference. These are operational tracking/evidence fields only; they are self-reported and do not prove approval. Statutory draft review requires reviewer name, qualification, professional registration/member number, review reference, and all four route declarations. The submit endpoint verifies those fields exist, then still fails closed because no certified KRA adapter or authorized statutory adapter is installed. Do not enter login passwords, private keys, API tokens, or certificates in those forms; issued secrets belong in server-side Render settings or an approved vault.

The implemented M-Pesa setup flow covers invoice STK Push and callback/query verification only. It does not offer full merchant reconciliation, refunds, settlement reporting, or guarantee provider approval. A manual invoice is still not an eTIMS invoice.

## Run locally

1. Install Node.js compatible with the package engines and Git.
2. From the repository root, run `npm ci`.
3. From `api/`, run `npm ci`.
4. Provision PostgreSQL for persistent local development. Copy `api/.env.example` to `api/.env`; set `DATABASE_URL` and `SESSION_SECRET` to local values. Without `DATABASE_URL`, the API uses a development-only in-memory database.
5. Start the API from `api/` with `npm run dev`.
6. In a second terminal at the repository root, copy `.env.example` to `.env.local`, set `VITE_API_BASE_URL=http://localhost:3001`, and run `npm run dev`.
7. Open the Vite URL printed in the terminal. If the default port is busy, use the URL Vite prints; local API CORS permits localhost origins in development.
8. Create the first business/admin account from the homepage.

Never commit `.env`, `.env.local`, database URLs, session secrets, passwords, private keys, or provider credentials.

## Project structure

- `src/` — React and TypeScript frontend.
- `api/src/server.ts` — Express API, authentication, database access, and current endpoints.
- `api/migrations/` — SQL schema migrations, automatically applied on API startup.
- `render.yaml` — Render Blueprint for the frontend, API, and PostgreSQL resources.

## Security and accounting notice

This is an early-stage MVP and is not a substitute for professional accounting, tax, payroll, legal, or security advice. Validate financial data and statutory calculations with qualified Kenyan professionals. Use least-privilege access, unique credentials, private server-side secrets, encrypted transport, database backups, restore tests, security monitoring, and a privacy review before storing real business or personal data.
