# KashFlow API foundation

This is a minimal secure-by-default API host for future provider adapters. It currently exposes `GET /healthz` and `GET /v1/integrations/readiness` only. It does not connect to providers or handle customer, payroll, tax, invoice, or payment data.

## Local development

Run `npm ci`, copy `.env.example` to `.env`, then run `npm run dev`. Do not commit `.env` or provider credentials. In production, configure values in the hosting provider's secret/environment settings.

## Before enabling real integrations

- Select approved providers and obtain sandbox credentials and written API access.
- Implement each provider adapter against its current API specification, including authentication, token rotation, signed callbacks, idempotency, retries, audit logging, and reconciliation.
- Add authenticated tenant/user authorization and a reviewed data model before persisting financial or employee data.
- Validate current statutory rules and filing flows with qualified Kenyan payroll/tax professionals.
- Complete sandbox/UAT, security review, and production approval before enabling production credentials.
