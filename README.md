# KashFlow

KashFlow is a Kenyan-first finance workspace. The app no longer seeds fictional companies, balances, transactions, invoices, or compliance statuses. After deployment and first-time setup, users sign in and save transaction and invoice records to the configured PostgreSQL database. The dashboard totals, chart, and lists are calculated from those saved records.

## Current working functionality

- First-admin workspace setup, password sign-in, signed HttpOnly sessions, and sign-out.
- Add multiple businesses, record team invitations with custom role labels, and scope each invitation to the active business or all businesses the inviter administers.
- Database-backed manual income/expense transaction entry and invoice entry.
- Workspace dashboard totals, recent transactions, and a daily chart sourced from saved records.
- Empty states when the workspace has no records.

Bank sync, card/mobile payment processing, customer emailing, payroll, statutory calculations, document storage, and filing are not implemented. KRA/eTIMS, Safaricom Daraja/M-Pesa, banks, SHIF, NSSF, and Affordable Housing Levy are explicitly shown as inactive. Entering an internal invoice does not make it a KRA eTIMS invoice or send it to a customer. Have qualified Kenyan payroll/tax professionals review any future statutory calculations and filing workflows.

## Run locally

1. Install frontend dependencies in the project root: `npm ci`.
2. Install API dependencies: from `api/`, run `npm ci`.
3. Create an empty PostgreSQL database; the API applies all SQL files in `api/migrations/` on startup.
4. Copy `api/.env.example` to `api/.env`; set the database URL and a random session secret of at least 32 characters. No fixed admin email is required.
5. Start the API from `api/` using `npm run dev`.
6. In the project root, copy `.env.example` to `.env.local` (it defaults to `http://localhost:3001`), then run `npm run dev` in another terminal.
7. Open the Vite URL, create your workspace by entering a business name, email or phone number, and a password of at least 12 characters, then sign in.

Do not commit `.env`, `.env.local`, database URLs, passwords, or provider secrets.

## Deploy on Render

The repository includes `render.yaml` for a static frontend, Node API, and managed PostgreSQL database. In Render, create a Blueprint from this repository and review the generated resources before applying it. Render generates `SESSION_SECRET` and links `DATABASE_URL` from the database. Confirm `FRONTEND_ORIGIN` exactly matches the resulting KashFlow static-site URL and `VITE_API_BASE_URL` exactly matches the API URL. If Render assigns different service URLs, update these two values and redeploy the API and frontend respectively. The homepage lets users create their own first workspace admin account with a business name, email or phone number, and a strong password.

### Environment variable reference

| Variable | Service | Required | Purpose |
|---|---|---:|---|
| `NODE_ENV` | API | Yes | Set to `production` on Render. |
| `PORT` | API | Render supplies it | HTTP listen port; local default is `3001`. |
| `FRONTEND_ORIGIN` | API | Yes | Exact frontend origin allowed by CORS and write-origin checks. |
| `DATABASE_URL` | API | Yes | Render PostgreSQL connection string; provisioned by the Blueprint. |
| `SESSION_SECRET` | API | Yes | Random secret of at least 32 characters used to sign sessions; generate in Render, never expose to the browser. |
| `VITE_API_BASE_URL` | Static site build | Yes | Public base URL for the API, e.g. `https://kashflow-api.onrender.com`. This is intentionally public, not a secret. |

`api/.env.example` contains the local API variables. For Render, use the service Environment settings or the Blueprint. Provider credential variable names from a provider's documentation should only be added after its adapter is implemented; arbitrary credentials do not activate an integration. Never use `VITE_*` for secrets because browser bundles are public.

## Data and security notes

Team invitations are recorded in the database but are not emailed or redeemable yet. Custom roles are stored as labels and do not grant configurable fine-grained permissions; business-scope selection records its target businesses but does not yet provision invited users. This MVP also lacks double-entry accounting, invoice payment/status management, backup tooling, and audited integration credential storage. Protect the Render account and database, use a unique strong first-admin password, enable appropriate backups, and do not enter regulated/payroll data until the application receives a security and privacy review. The database schema is in `api/migrations/`.

The API exposes `GET /healthz` and `GET /v1/integrations/readiness` for operational/status checks. No external provider credentials are currently consumed by the code. Live KRA, M-Pesa, banking, and statutory integrations still require approved providers, credentials, provider-specific adapters, verified callbacks/webhooks, sandbox tests, and production approval.
