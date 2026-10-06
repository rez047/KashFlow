# KashFlow API

The API provides first-admin workspace setup, password sign-in, signed HttpOnly sessions, multiple businesses, expiring team invitations, business records, multi-line estimates and invoices, partial invoice/bill payments, supplier bills and approvals, inventory movements and purchase orders, project time entries, recurring transaction templates, budgets/aging/cash-flow estimates, balanced double-entry journals, financial statements, bank reconciliation, accounting-period close/reopen, encrypted employee/payslip storage, monthly draft payroll runs and manual remittance tracking, an optional Safaricom Daraja M-Pesa STK Push flow, and health/readiness endpoints. It applies SQL files in `migrations/` at startup when `DATABASE_URL` is set.

## Required environment

- `NODE_ENV`: set `production` when deployed.
- `PORT`: supplied by Render; defaults to `3001` locally.
- `FRONTEND_ORIGIN`: exact frontend URL; local dev usually uses `http://localhost:5173` or a Vite port such as `5175` when 5173 is in use.
- `DATABASE_URL`: PostgreSQL connection string. If left unset, the API falls back to a local in-memory PostgreSQL-compatible database for development-only testing.
- `SESSION_SECRET`: at least 32 characters; signs HttpOnly session cookies.
- `PAYROLL_DATA_ENCRYPTION_KEY`: at least 32 characters, independent of `SESSION_SECRET`; required in production and for all employee/payslip storage. Loss of this key makes encrypted payroll fields unreadable.
- `MPESA_ENV`: `sandbox` (default) or `production`.
- `MPESA_CONSUMER_KEY`: Daraja app consumer key.
- `MPESA_CONSUMER_SECRET`: Daraja app consumer secret; server-side only.
- `MPESA_SHORTCODE`: PayBill/Till shortcode authorized for STK Push.
- `MPESA_PASSKEY`: Daraja STK Push passkey; server-side only.
- `MPESA_CALLBACK_URL`: publicly reachable URL ending in `/v1/integrations/mpesa/callback`; HTTPS is required in production.
- `MPESA_TRANSACTION_TYPE`: `CustomerPayBillOnline` by default or `CustomerBuyGoodsOnline` when supported by the merchant setup.

There is no fixed admin email required. The homepage self-serve flow lets the first user create their own workspace admin account using a business name, email or phone number, and a password of at least 12 characters.

Invitations can be scoped to the current business or all businesses the inviter administers. They expire after seven days and are single-use. Resend email delivery is optional; otherwise the API returns a secure manual link to the administrator. Invitees may accept using a matching signed-in account or create an account for the invited email. Basic admin/accountant/staff/viewer checks protect selected writes; authorization is not comprehensive across every endpoint and requires security review.

## M-Pesa Daraja STK Push

The API has a Daraja STK Push integration for whole-KSh, unpaid invoices. To enable it, onboard a Safaricom Daraja application and merchant shortcode, first use sandbox credentials, then set the five required `MPESA_*` values (`MPESA_CONSUMER_KEY`, `MPESA_CONSUMER_SECRET`, `MPESA_SHORTCODE`, `MPESA_PASSKEY`, and `MPESA_CALLBACK_URL`) in this service's server-side environment. `MPESA_ENV` and `MPESA_TRANSACTION_TYPE` have defaults. Set the callback URL to the deployed API callback route. The invoice form's optional M-Pesa phone field initiates the prompt; a successful callback is checked using Daraja's STK Query endpoint before the invoice is marked paid. The API also exposes `GET /v1/invoices/:invoiceId/payments/mpesa` for payment status.

The callback must be reachable by Safaricom over the public internet; use an HTTPS deployment or secure HTTPS tunnel for sandbox testing. Do not trust a successful browser response as proof of payment; reconcile the saved payment with the callback, Daraja query, and merchant statement. Real transactions require Safaricom approval, correct shortcode/passkey setup, production credentials, HTTPS callback testing, and operational reconciliation. No live credentials are included in the repository.

## Kenya payroll estimate

`POST /v1/payroll/kenya/estimate` accepts `grossMonthlyPay`, optional `otherTaxableDeductions`, and optional `otherTaxReliefs`. It returns employee/employer NSSF, SHIF, employee/employer Affordable Housing Levy, PAYE/net/employer-cost estimates, and assumptions under `KE-2026-01` (snapshot effective `2026-02-01`). The snapshot uses NSSF 6% capped at KSh 108,000 pensionable pay, SHIF 2.75% with a KSh 300 minimum for positive gross pay, AHL 1.5% for employee and employer, monthly resident PAYE bands, and personal relief up to KSh 2,400. It does not persist estimate inputs. It is not legal/tax advice, statutory filing, or production-verified. Rules do not update automatically; qualified Kenyan payroll/tax review is mandatory before real use.

Admin-only payroll routes store employee and payslip fields encrypted using AES-256-GCM and `PAYROLL_DATA_ENCRYPTION_KEY`. They support employee records, one draft run per period, generated payslip data, posting a reviewed run to the ledger, recording payroll as paid, and remittance-reference tracking. Posting creates balanced payroll journals. Recording a payment reference only records an externally made payment; KashFlow does not pay employees, send statutory remittances, or file PAYE/SHIF/NSSF/AHL returns. Protect and back up the encryption key; losing it makes stored employee/payslip fields unreadable.

Accounting exposes the chart/trial balance, date-ranged income statement and as-of balance sheet reports, posted journals, balanced manual journal posting, manual bank reconciliation, and admin period close/reopen. Financial statements are calculated from posted workspace journal lines; accumulated income/expenses are shown as unclosed earnings. Reports are operational summaries, not audited statements, and depend on complete opening balances and reviewed account mappings. Estimates do not post until accepted and converted to invoices. Invoices and bills support partial recorded payments; bills may require approval before posting. Invoice/bill payment and invoice-sale stock/COGS updates are committed with their corresponding journals in database transactions. Reconciliation matches already-posted `ledger_transactions` by account label and date range, and closes only when the matched net balance equals the supplied statement ending balance. Automated statement-line matching from a review queue, audit certification, journal edits/reversals, and period-end review controls still require further work and qualified review.

## Business workflow endpoints

- `GET/POST /v1/invoices`, `POST /v1/invoices/:invoiceId/payments`, and the M-Pesa payment routes manage itemized invoices and recorded payments. An optional `itemId` on a line associates it with an inventory record; invoice posting locks the item, rejects insufficient stock, writes a sale movement, deducts stock, and posts cost of goods sold/inventory with the receivable journal.
- `GET/POST /v1/estimates`, `PATCH /v1/estimates/:estimateId/status`, and `POST /v1/estimates/:estimateId/convert` manage itemized estimates. Conversion is only allowed for an accepted, not-yet-converted estimate and posts linked stock movements and the invoice atomically.
- `/v1/bills`, bill payment/approval routes, `/v1/inventory/:itemId/movements`, `/v1/purchase-orders`, and purchase-order receiving manage payables and inventory. Receipts create supplier bills; inventory issues use the recorded weighted-average cost.
- `/v1/projects/:projectId/time`, project review/summary routes, `/v1/recurring`, `/v1/reports/budgets`, `/v1/reports/aging`, and `/v1/reports/cash-flow-forecast` provide management tracking. Recurring entries require deliberate user execution; the forecast uses available historical cash movements and is not a guarantee.

Line prices, tax amounts, recoverable tax, hours, costs, and statutory/payroll assumptions require user input and appropriate qualified review. KashFlow does not calculate Kenyan tax determinations; an internal invoice is not an eTIMS fiscal tax invoice.

Payroll endpoints persist encrypted employee/payslip fields, prepare one monthly draft from active employees, let admins post a reviewed run to the ledger, and create due remittance rows. Record payment references only after paying through official channels: KashFlow does not send staff pay or statutory remittances and does not file returns. Use a unique, securely backed-up `PAYROLL_DATA_ENCRYPTION_KEY`; changing or losing it makes prior employee/payslip records unreadable. Employee data are sensitive and require a security/privacy review, least-privilege controls, backup/restore, and key recovery plans.

Manual transactions and invoices create balanced debit/credit journal entries. `GET /v1/accounting/trial-balance` aggregates the chart; `GET /v1/accounting/journals` lists posted entries; `POST /v1/accounting/journals` accepts a balanced manual journal. Admins can close a balanced month with `POST /v1/accounting/periods/:period/close` and reopen it with `/reopen`; journal postings are blocked in a closed month.

Copy `.env.example` to `.env` and configure a local PostgreSQL database. Run `npm ci` and `npm run dev`. Do not commit `.env` or credentials.

The KRA OSCU client, Mono bank-feed adapter, and Daraja STK Push flow exist, but each requires provider onboarding, credentials, configuration, consent/approval, and end-to-end verification; environment variables alone do not certify or authorize them. The app does not submit PAYE, AHL, SHIF/SHA, or NSSF filings or transfer remittances: it prepares internal estimates, drafts, journal postings, and reference tracking only. Do not use this system for real payroll without qualified review and appropriate security/privacy/backup controls. Manual invoice records remain internal only: they are not eTIMS tax invoices. M-Pesa collection does not make an invoice an eTIMS invoice.