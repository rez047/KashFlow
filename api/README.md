# KashFlow API

The API provides first-admin workspace setup, password sign-in, signed HttpOnly sessions, multiple businesses, recorded team invitations, database-backed manual transactions and invoices, dashboard aggregates, and health/readiness endpoints. It applies SQL files in `migrations/` at startup when `DATABASE_URL` is set.

## Required environment

- `NODE_ENV`: set `production` when deployed.
- `PORT`: supplied by Render; defaults to `3001` locally.
- `FRONTEND_ORIGIN`: exact frontend URL; local dev usually uses `http://localhost:5173` or a Vite port such as `5175` when 5173 is in use.
- `DATABASE_URL`: PostgreSQL connection string. If left unset, the API falls back to a local in-memory PostgreSQL-compatible database for development-only testing.
- `SESSION_SECRET`: at least 32 characters; signs HttpOnly session cookies.

There is no fixed admin email required. The homepage self-serve flow lets the first user create their own workspace admin account using a business name, email or phone number, and a password of at least 12 characters.

Invitations can be scoped to the current business or all businesses the inviter administers, with a custom role label. They are saved only: email delivery, invitation acceptance, and fine-grained custom-role permission enforcement are not implemented yet.

Copy `.env.example` to `.env` and configure a local PostgreSQL database. Run `npm ci` and `npm run dev`. Do not commit `.env` or credentials.

The API does not yet connect to KRA/eTIMS, Safaricom Daraja, bank feeds, or statutory filing services. Do not accept/store payroll or regulated data before appropriate security, privacy, backup, and professional reviews. Manual invoice records are internal only and are not eTIMS tax invoices or sent to customers.