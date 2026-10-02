# KashFlow

KashFlow is a Kenyan-first accounting workspace prototype built with React, TypeScript, and Vite. The current experience demonstrates a finance dashboard, cash-flow chart, transaction search, invoice and transaction entry dialogs, module navigation, and a Kenya compliance overview for KRA eTIMS, PAYE, SHIF, NSSF, and Affordable Housing Levy.

## Run locally

Install dependencies with `npm install`, then start the development server with `npm run dev`. Run `npm run build` to type-check and create a production build.

## Prototype scope and compliance note

This workspace currently uses illustrative, in-memory sample data. It does not connect to QuickBooks, KRA, eTIMS, SHIF, NSSF, banks, or M-Pesa; it does not submit filings or provide payroll/tax calculations. Government and payment integrations require approved providers, credentials, security controls, tested statutory rules, and legal/accounting review before production use. Navigation for accounting, payroll, sales, inventory, projects, reports, documents, and other areas currently represents product structure rather than complete working features.

## Next implementation stages

1. Define tenant/user roles, audit logs, and a secure backend.
2. Implement double-entry ledger, chart of accounts, taxes, invoices, receivables, payables, reconciliation, and financial reports.
3. Implement payroll and maintain versioned statutory rules for PAYE, SHIF, NSSF, and Affordable Housing Levy.
4. Build provider-based integrations for KRA/eTIMS, Kenyan banks, and M-Pesa; validate against sandbox accounts and current provider requirements.
5. Add persistence, automated tests, backups, access controls, and deployment monitoring.

## Backend and live integrations

A small Express API foundation is in `api/`; the Render Blueprint is in `render.yaml`. The API currently exposes health and integration-readiness endpoints only. It is not a live connection to KRA/eTIMS, Safaricom Daraja, banks, SHIF, NSSF, or Affordable Housing Levy. The UI marks sample values and compliance statuses as demo/setup-required.

The Render Blueprint provisions the static frontend, API web service, and PostgreSQL database. Before real provider calls or employee/financial data storage, implement tenant authentication, authorization, audit history, migrations, provider-specific adapters, webhook verification, idempotency, and reviewed data-retention/security controls. Live activation also requires provider approval, sandbox credentials, current API specifications, and qualified Kenyan payroll/tax review. Configure secrets in Render environment settings only; never commit them.

## Environment variables

Use this section as the setup checklist. **Only the API variables in the first table are read by the current code.** The provider variable names below are proposed names for the future integration adapters; adding them to Render alone will not connect any services. Provider APIs, approval, and authentication flows must be implemented and tested first.

### Current API variables

| Name | Required | Example / source | Used for |
|---|---|---|---|
| `NODE_ENV` | Yes in production | `production` | Runtime mode; validated by the API. |
| `PORT` | Supplied by Render; local default is `3001` | `3001` | API listen port. |
| `FRONTEND_ORIGIN` | Yes | Local: `http://localhost:5173`; production: exact KashFlow static-site origin, e.g. `https://kashflow.onrender.com` | CORS allow-list for browser requests. Must match the deployed frontend origin exactly. |
| `DATABASE_URL` | Required when enabling persistence | Render PostgreSQL connection string | PostgreSQL connection. Render Blueprint can populate this automatically. Current API only checks database health; application data persistence is not implemented. |

Local API setup: copy `api/.env.example` to `api/.env` and adjust local values. Keep `.env` files out of Git. For Render, set API variables under the **kashflow-api service → Environment**; use Render's linked database variable for `DATABASE_URL`.

### Provider variables to add when adapters are implemented

These are suggested KashFlow names, **not official provider-defined environment variable names**. Confirm the exact credentials, scopes, endpoints, and callback URLs with each approved provider before creating the Render variables. Never put secrets in frontend variables such as `VITE_*`; those values are embedded in browser JavaScript and are public.

| Integration | Suggested variable names | Setup notes |
|---|---|---|
| KashFlow frontend → API | `VITE_API_BASE_URL` | Public API base URL, e.g. `https://kashflow-api.onrender.com`. Frontend code must be updated to read and use this variable. |
| App authentication / sessions | `SESSION_SECRET`, `DATA_ENCRYPTION_KEY` | Generate high-entropy secrets and store only in API service environment. Authentication, session handling, and encryption are not implemented yet. |
| KRA eTIMS (through an approved integration provider) | `ETIMS_PROVIDER`, `ETIMS_API_BASE_URL`, `ETIMS_CLIENT_ID`, `ETIMS_CLIENT_SECRET`, `ETIMS_CALLBACK_URL`, `ETIMS_WEBHOOK_SECRET` | The approved eTIMS route and any required KRA/provider identifiers must be confirmed. Do not assume direct API access is available. |
| Safaricom Daraja / M-Pesa | `MPESA_ENV`, `MPESA_CONSUMER_KEY`, `MPESA_CONSUMER_SECRET`, `MPESA_SHORTCODE`, `MPESA_PASSKEY`, `MPESA_CALLBACK_BASE_URL`, `MPESA_WEBHOOK_SECRET` | Start with Daraja sandbox credentials; configure public HTTPS callback URLs and verify callbacks. No Daraja adapter is implemented yet. |
| Bank feeds | `BANK_FEED_PROVIDER`, `BANK_FEED_API_BASE_URL`, `BANK_FEED_CLIENT_ID`, `BANK_FEED_CLIENT_SECRET`, `BANK_FEED_WEBHOOK_SECRET` | Choose a provider that supports the target Kenyan banks; confirm bank/customer consent and data-access requirements. |
| Statutory filing provider (only if approved API access exists) | `STATUTORY_PROVIDER`, `STATUTORY_API_BASE_URL`, `STATUTORY_CLIENT_ID`, `STATUTORY_CLIENT_SECRET`, `STATUTORY_WEBHOOK_SECRET` | Confirm separately which, if any, approved provider supports PAYE, SHIF, NSSF, and Affordable Housing Levy submissions. Filing integration is not implemented. |

### Per-business credentials and identifiers

Do **not** set customer-specific or employee-specific credentials as shared Render environment variables. Items such as KRA PINs, M-Pesa till/paybill identifiers, bank authorizations, employee records, and provider account tokens belong to the relevant business tenant and should be stored in access-controlled, encrypted application storage after tenant security and consent flows exist. The current product does not yet implement that storage.

### Safe configuration checklist

1. Deploy frontend and API; copy the exact frontend origin into API `FRONTEND_ORIGIN`.
2. Add Render PostgreSQL and connect `DATABASE_URL` to the API.
3. Obtain provider approval and sandbox credentials; identify exact APIs and callback requirements.
4. Implement provider adapters, secure tenant authentication, encrypted credential storage, webhook signature checks, idempotency, audit logging, retry/reconciliation handling, and tests.
5. Validate payroll/tax rules and filing flows with qualified Kenyan professionals; test in sandbox/UAT.
6. Add provider secrets to the API's encrypted Render environment settings—not to the frontend, README, source code, or Git repository.
7. Enable production credentials only after provider approval, security review, and end-to-end sign-off.
