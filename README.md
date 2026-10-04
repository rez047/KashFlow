# KashFlow

KashFlow is a Kenyan-first, cloud-hosted business finance workspace built with React, TypeScript, Vite, Express, and PostgreSQL. It is intended to help small businesses keep basic financial records in one place. It is an early MVP, **not a feature-complete QuickBooks Advanced replacement** and not yet production-ready for regulated accounting, payroll, or statutory filing.

## What it currently does

- Lets a business owner create the first administrator account from the homepage using a business name, email or phone number, and their own password.
- Provides password sign-in, signed HttpOnly session cookies, and sign-out.
- Lets a signed-in user create additional businesses/workspaces and switch to the newly created business.
- Saves manual income/expense records and internal invoice records to PostgreSQL.
- Shows saved transactions, monthly totals, a daily cash-flow chart, and unpaid invoice totals.
- Lets an administrator record an invitation with an email, built-in or custom role label, and target scope of the active business or all businesses they administer.
- Uses Kenyan Shillings (KSh) in the finance UI and describes the intended local compliance integrations transparently.

## Important implementation and readiness limits

Do not treat UI labels, environment variables, or saved invitation records as working third-party integrations. The current repository does **not** include:

- A KRA/eTIMS adapter, certification, live invoice submission, fiscal-device integration, or production credentials.
- Safaricom Daraja/M-Pesa STK Push, callbacks, reconciliation, refunds, or live payment processing.
- Bank-feed providers, OAuth connections, transaction imports, or reconciliation.
- Payroll processing or verified PAYE, SHIF, NSSF, or Affordable Housing Levy calculations/filing.
- Double-entry journal posting, chart of accounts, trial balance, financial statements, or period close.
- Invoice email/delivery, customer payment collection, or complete payment/status management.
- Invitation email delivery, invitation acceptance, membership provisioning, or fine-grained permission enforcement. Custom role values are labels only; invitation scope is recorded but does not grant the invitee access.
- Automated backup/restore tools, audited integration-credential vault, document storage, inventory, projects, or a full audit trail.

The product interface currently indicates that external integrations are inactive. Production use requires qualified Kenyan accounting/payroll review, security/privacy review, tested provider integrations, operational monitoring, and tested backup and recovery. Do not enter sensitive payroll, tax, banking, or personal data until those controls are in place.

## Deploy to Render (Blueprint)

The repository includes [render.yaml](render.yaml), which describes a static frontend, Node API, and managed PostgreSQL database. Render may change service URLs or Blueprint defaults; inspect the plan before applying it.

1. Push this repository to GitHub and sign in to [Render](https://render.com/).
2. In Render, choose **New → Blueprint**, connect the GitHub repository `rez047/KashFlow`, and select the `main` branch.
3. Review the Blueprint resources before applying: `kashflow-api` (Node web service), `kashflow-frontend` (static site), and `kashflow-db` (PostgreSQL). Confirm the database plan, region, cost, and retention meet your needs; the configured database plan may incur charges.
4. Apply the Blueprint and wait for the database and services to provision. The API runs `npm ci && npm run build`, starts with `npm start`, and checks `/healthz`. The static site builds with `npm ci && npm run build` and publishes `dist`.
5. In the API service's **Environment** settings, confirm these values:
   - `NODE_ENV=production`
   - `DATABASE_URL` is linked to the Render PostgreSQL connection string.
   - `SESSION_SECRET` is a Render-generated secret with at least 32 characters. Keep it private; rotating it signs out existing sessions.
   - `FRONTEND_ORIGIN` is the exact HTTPS origin of the deployed frontend, with no path or trailing slash (for example, `https://kashflow-frontend.onrender.com`).
6. In the frontend static site's **Environment** settings, confirm `VITE_API_BASE_URL` is the exact HTTPS base URL of the API (for example, `https://kashflow-api.onrender.com`), with no path. Because `VITE_*` values are included in the public browser bundle, never put secrets there.
7. Save environment changes and redeploy both services. If Render generated URLs different from the example, update both sides: set API `FRONTEND_ORIGIN` to the frontend's actual origin and frontend `VITE_API_BASE_URL` to the API's actual URL, then redeploy.
8. Check `https://<your-api-host>/healthz` returns `{"status":"ok","database":"available"}`. Check the frontend URL loads, create the first admin account, and verify sign-in, sign-out, business creation, and manual record entry.
9. Before production data: configure and test database backups/restore, access and security policies, monitoring/alerts, privacy notices, domain/TLS settings, and incident recovery. The app does not currently provide backup tooling or invitation email delivery.

### Render deployment troubleshooting

- **CORS/request-origin errors:** `FRONTEND_ORIGIN` must match the browser origin exactly, including `https://`, and the API must be redeployed after changing it.
- **API unreachable:** verify `VITE_API_BASE_URL` points to the API service, not the static frontend; redeploy the static site after changing it.
- **Database unavailable:** verify the `DATABASE_URL` reference points to the provisioned database and that database/service regions and access are correct.
- **No first-account setup:** setup is enabled only when the database has no users. Do not delete production users just to re-enable bootstrap.
- **Render free instances:** may sleep or have other limits depending on current Render plans; review Render's current pricing, persistence, and database backup terms before selecting a plan.

## Required environment variables

These are the variables used by the **current code**. The Blueprint sets or links them. Do not create provider credentials expecting them to activate integrations; no external provider adapters currently read provider credentials.

| Name | Where | Required | Value / purpose |
|---|---|---:|---|
| `NODE_ENV` | API | Yes in production | Set to `production`; selects secure cookie and production configuration behavior. |
| `PORT` | API | Render supplies it | HTTP listening port. Local default is `3001`; normally do not set manually on Render. |
| `FRONTEND_ORIGIN` | API | Yes | Exact frontend HTTPS origin allowed by CORS and write-origin checks. |
| `DATABASE_URL` | API | Yes in production | PostgreSQL connection URL; linked from the Render database resource. |
| `SESSION_SECRET` | API | Yes in production | Random secret, minimum 32 characters, used to sign sessions. Generate in Render; never commit or expose to the frontend. |
| `VITE_API_BASE_URL` | Static site build | Yes | Public base URL for the API; not a secret. Vite embeds it in the browser build. |

No first-admin email/password is provided or required: the first user chooses these from the homepage. The API also uses local defaults for `NODE_ENV`, `PORT`, and `FRONTEND_ORIGIN` during development; production must have the required values above. For local development, copy [api/.env.example](api/.env.example) to `api/.env`, set `DATABASE_URL` and a random `SESSION_SECRET`, then copy [.env.example](.env.example) to `.env.local` and set `VITE_API_BASE_URL=http://localhost:3001`. The development-only in-memory `pg-mem` fallback loses data when the API restarts; do not use it for deployment.

### Provider-specific variables (future work only)

The current code does not read any KRA/eTIMS, Daraja/M-Pesa, bank, email, payroll, SHIF, NSSF, or Affordable Housing Levy credentials. Therefore there are **no provider environment-variable names that can make these services live today**. When a provider adapter is implemented and approved, use that provider's current official documentation to define the exact credential names, callback URLs, encryption/storage requirements, sandbox-to-production process, and rotation plan. Store secrets only in server-side Render environment settings or a purpose-built encrypted credential vault—not in `VITE_*`, source control, or README values. Never claim a statutory or payment integration is live until end-to-end provider tests and production approval have succeeded.

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
