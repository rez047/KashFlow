# KashFlow API

The API provides first-admin workspace setup, password sign-in, signed HttpOnly sessions, multiple businesses, recorded team invitations, database-backed manual transactions and invoices, an optional Safaricom Daraja M-Pesa STK Push flow, dashboard aggregates, and health/readiness endpoints. It applies SQL files in `migrations/` at startup when `DATABASE_URL` is set.

## Required environment

- `NODE_ENV`: set `production` when deployed.
- `PORT`: supplied by Render; defaults to `3001` locally.
- `FRONTEND_ORIGIN`: exact frontend URL; local dev usually uses `http://localhost:5173` or a Vite port such as `5175` when 5173 is in use.
- `DATABASE_URL`: PostgreSQL connection string. If left unset, the API falls back to a local in-memory PostgreSQL-compatible database for development-only testing.
- `SESSION_SECRET`: at least 32 characters; signs HttpOnly session cookies.
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

Copy `.env.example` to `.env` and configure a local PostgreSQL database. Run `npm ci` and `npm run dev`. Do not commit `.env` or credentials.

KRA/eTIMS, bank feeds, PAYE/SHIF/NSSF/Affordable Housing Levy calculations and filing are not implemented. Do not accept/store payroll or regulated data before appropriate security, privacy, backup, and professional reviews. Manual invoice records remain internal only: they are not eTIMS tax invoices and are not sent to customers. M-Pesa collection requires the Daraja setup above and does not make an invoice an eTIMS invoice.