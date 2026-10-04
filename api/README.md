# KashFlow API

The API provides first-admin workspace setup, password sign-in, signed HttpOnly sessions, multiple businesses, recorded team invitations, database-backed manual transactions and invoices, balanced double-entry journals, a chart of accounts and trial balance, accounting-period close/reopen, encrypted employee/payslip storage, monthly draft payroll runs and manual remittance tracking, an optional Safaricom Daraja M-Pesa STK Push flow, and health/readiness endpoints. It applies SQL files in `migrations/` at startup when `DATABASE_URL` is set.

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

Invitations can be scoped to the current business or all businesses the inviter administers, with a custom role label. They are saved only: email delivery, invitation acceptance, and fine-grained custom-role permission enforcement are not implemented yet.

## M-Pesa Daraja STK Push

The API has a Daraja STK Push integration for whole-KSh, unpaid invoices. To enable it, onboard a Safaricom Daraja application and merchant shortcode, first use sandbox credentials, then set the five required `MPESA_*` values (`MPESA_CONSUMER_KEY`, `MPESA_CONSUMER_SECRET`, `MPESA_SHORTCODE`, `MPESA_PASSKEY`, and `MPESA_CALLBACK_URL`) in this service's server-side environment. `MPESA_ENV` and `MPESA_TRANSACTION_TYPE` have defaults. Set the callback URL to the deployed API callback route. The invoice form's optional M-Pesa phone field initiates the prompt; a successful callback is checked using Daraja's STK Query endpoint before the invoice is marked paid. The API also exposes `GET /v1/invoices/:invoiceId/payments/mpesa` for payment status.

The callback must be reachable by Safaricom over the public internet; use an HTTPS deployment or secure HTTPS tunnel for sandbox testing. Do not trust a successful browser response as proof of payment; reconcile the saved payment with the callback, Daraja query, and merchant statement. Real transactions require Safaricom approval, correct shortcode/passkey setup, production credentials, HTTPS callback testing, and operational reconciliation. No live credentials are included in the repository.

## Kenya payroll estimate

`POST /v1/payroll/kenya/estimate` accepts `grossMonthlyPay`, optional `otherTaxableDeductions`, and optional `otherTaxReliefs`. It returns employee/employer NSSF, SHIF, employee/employer Affordable Housing Levy, PAYE/net/employer-cost estimates, and assumptions under `KE-2026-01` (snapshot effective `2026-02-01`). The snapshot uses NSSF 6% capped at KSh 108,000 pensionable pay, SHIF 2.75% with a KSh 300 minimum for positive gross pay, AHL 1.5% for employee and employer, monthly resident PAYE bands, and personal relief up to KSh 2,400. It does not persist estimate inputs. It is not legal/tax advice, statutory filing, or production-verified. Rules do not update automatically; qualified Kenyan payroll/tax review is mandatory before real use.

Admin-only payroll routes store employee and payslip fields encrypted using AES-256-GCM and `PAYROLL_DATA_ENCRYPTION_KEY`. They support employee records, one draft run per period, generated payslip data, posting a reviewed run to the ledger, recording payroll as paid, and remittance-reference tracking. Posting creates balanced payroll journals. Recording a payment reference only records an externally made payment; KashFlow does not pay employees, send statutory remittances, or file PAYE/SHIF/NSSF/AHL returns. Protect and back up the encryption key; losing it makes stored employee/payslip fields unreadable.

Accounting exposes the chart/trial balance, posted journals, balanced manual journal posting, and admin period close/reopen. Manual transactions, invoices, posted payroll, and payroll payment create double-entry journal lines in database transactions. Closed accounting periods reject additional journal postings. Financial statements, bank reconciliation, audit certification, journal edits/reversals, and period-end review controls still require further work and qualified review.

Payroll endpoints persist encrypted employee/payslip fields, prepare one monthly draft from active employees, let admins post a reviewed run to the ledger, and create due remittance rows. Record payment references only after paying through official channels: KashFlow does not send staff pay or statutory remittances and does not file returns. Use a unique, securely backed-up `PAYROLL_DATA_ENCRYPTION_KEY`; changing or losing it makes prior employee/payslip records unreadable. Employee data are sensitive and require a security/privacy review, least-privilege controls, backup/restore, and key recovery plans.

Manual transactions and invoices create balanced debit/credit journal entries. `GET /v1/accounting/trial-balance` aggregates the chart; `GET /v1/accounting/journals` lists posted entries; `POST /v1/accounting/journals` accepts a balanced manual journal. Admins can close a balanced month with `POST /v1/accounting/periods/:period/close` and reopen it with `/reopen`; journal postings are blocked in a closed month.

Copy `.env.example` to `.env` and configure a local PostgreSQL database. Run `npm ci` and `npm run dev`. Do not commit `.env` or credentials.

KRA/eTIMS and bank feeds are not implemented. The app does not submit payroll/statutory filings or transfer remittances: it prepares internal estimates, drafts, journal postings, and reference tracking only. Do not use this system for real payroll without qualified review and appropriate security/privacy/backup controls. Manual invoice records remain internal only: they are not eTIMS tax invoices and are not emailed. M-Pesa collection requires the Daraja setup above and does not make an invoice an eTIMS invoice.