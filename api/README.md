# KashFlow API

The API provides first-admin workspace setup, password sign-in, signed HttpOnly sessions, database-backed manual transactions and invoices, dashboard aggregates, and health/readiness endpoints. It automatically applies the idempotent SQL schema in `migrations/001_core.sql` at startup when `DATABASE_URL` is set.

## Required environment

- `NODE_ENV`: set `production` when deployed.
- `PORT`: supplied by Render; defaults to `3001` locally.
- `FRONTEND_ORIGIN`: exact frontend URL; CORS and write requests are restricted to this origin.
- `DATABASE_URL`: PostgreSQL connection string.
- `SESSION_SECRET`: at least 32 characters; signs HttpOnly session cookies.
- `BOOTSTRAP_ADMIN_EMAIL`: email allowed to create the first administrator/workspace. Bootstrap closes as soon as that account is created.
- `FRONTEND_ORIGIN`: exact browser site origin allowed by CORS and write-origin checks.
- `DATABASE_URL`: PostgreSQL connection string; required. The schema applies at startup.

Copy `.env.example` to `.env` and configure a local PostgreSQL database. Run `npm ci` and `npm run dev`. Do not commit `.env` or credentials.

The API does not yet connect to KRA/eTIMS, Safaricom Daraja, bank feeds, or statutory filing services. Do not accept/store payroll or regulated data before appropriate security, privacy, backup, and professional reviews. Manual invoice records are internal only and are not eTIMS tax invoices or sent to customers.