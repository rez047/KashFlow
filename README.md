# KashFlow

KashFlow is a Kenyan-first, cloud-hosted business finance workspace built with React, TypeScript, Vite, Express, and PostgreSQL. It is intended to help small businesses keep basic financial records in one place. It is an early MVP, **not a feature-complete QuickBooks Advanced replacement** and not yet production-ready for regulated accounting, payroll, or statutory filing.

## What it currently does

- Lets a business owner create the first administrator account from the homepage using a business name, email or phone number, and their own password.
- Provides password sign-in, signed HttpOnly session cookies, and sign-out.
- Lets a signed-in user create additional businesses/workspaces and switch to the newly created business.
- Saves manual income/expense records and internal invoice records to PostgreSQL.
- Shows saved transactions, monthly totals, a daily cash-flow chart, and unpaid invoice totals.
- Can initiate a Safaricom Daraja M-Pesa STK Push for a whole-KSh unpaid invoice when merchant credentials and a public callback URL are configured; it verifies the callback with Daraja's STK Query API before marking the invoice paid.
- Provides a non-persisting, versioned Kenya payroll estimate API and Payroll screen for PAYE, employee/employer NSSF, SHIF, and Affordable Housing Levy, with explicit assumptions and review warnings.
- Lets an administrator record an invitation with an email, built-in or custom role label, and target scope of the active business or all businesses they administer.
- Uses Kenyan Shillings (KSh) in the finance UI and describes the intended local compliance integrations transparently.

## Important implementation and readiness limits

Do not treat UI labels, environment variables, or saved invitation records as working third-party integrations. The current repository does **not** include:

- Payroll processing, payroll data storage, payroll runs, employee records, payslips, remittance payments, or statutory filing. The estimator accepts aggregate calculation inputs in memory only; its dated formula snapshot is not certified for payroll use, and rates/tax eligibility require professional verification.
- Double-entry journal posting, chart of accounts, trial balance, financial statements, or period close.
- Invoice email/delivery, customer payment collection, or complete payment/status management.
- Invitation email delivery, invitation acceptance, membership provisioning, or fine-grained permission enforcement. Custom role values are labels only; invitation scope is recorded but does not grant the invitee access.
- Automated backup/restore tools, audited integration-credential vault, document storage, inventory, projects, or a full audit trail.

M-Pesa STK Push can become configured when its server-side Daraja settings are present; this does not certify live payments. Payroll offers estimates only, and KRA/eTIMS, bank feeds, payroll processing, and statutory filing remain unavailable. Production use requires qualified Kenyan accounting/payroll review, security/privacy review, provider onboarding, operational monitoring, and tested backup and recovery. Do not enter sensitive payroll, tax, banking, or personal data until those controls are in place.

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
10. Optional M-Pesa setup: complete Daraja merchant/app onboarding, add every `MPESA_*` value in the API service environment, set the callback to `https://<your-api-host>/v1/integrations/mpesa/callback`, redeploy the API, then test with sandbox credentials and a Safaricom-reachable HTTPS callback before considering production mode.

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
| `VITE_API_BASE_URL` | Static site build | Yes | Public base URL for the API; not a secret. Vite embeds it in the browser build. |
| `MPESA_ENV` | API | Optional | `sandbox` (default) or `production`. Do not select production until Safaricom has approved and provided live merchant details. |
| `MPESA_CONSUMER_KEY` | API | Required for STK Push | Daraja app consumer key. Server-side configuration only. |
| `MPESA_CONSUMER_SECRET` | API | Required for STK Push | Daraja app consumer secret. Keep private. |
| `MPESA_SHORTCODE` | API | Required for STK Push | PayBill/Till shortcode enabled for the selected STK transaction type. |
| `MPESA_PASSKEY` | API | Required for STK Push | Daraja STK Push passkey for that shortcode. Keep private. |
| `MPESA_CALLBACK_URL` | API | Required for STK Push | Public callback URL ending `/v1/integrations/mpesa/callback`; production must use HTTPS and be reachable by Safaricom. |
| `MPESA_TRANSACTION_TYPE` | API | Optional | `CustomerPayBillOnline` (default) or `CustomerBuyGoodsOnline`, according to merchant configuration. |

Payroll estimation is available through the authenticated `POST /v1/payroll/kenya/estimate` endpoint and the Payroll screen. Rule set `KE-2026-01` (snapshot effective `2026-02-01`) uses employee/employer NSSF at 6% of pensionable pay up to KSh 108,000; employee SHIF at 2.75% with a KSh 300 minimum when gross pay is positive; employee and employer Housing Levy at 1.5% each; monthly resident PAYE bands of 10% on the first KSh 24,000, 25% on the next KSh 8,333, 30% on the next KSh 467,667, 32.5% on the next KSh 300,000, and 35% thereafter; and monthly personal relief up to KSh 2,400. These values are a code snapshot, not auto-updated legal rules. The estimator accepts aggregate values in memory, does not use environment variables, and does not persist inputs. Before relying on it, check current KRA, NSSF and SHA guidance, confirm staff-specific eligibility and deductions, and obtain qualified review. There is no payroll processing, remittance, or statutory filing configuration yet.

No first-admin email/password is provided or required: the first user chooses these from the homepage. The API also uses local defaults for `NODE_ENV`, `PORT`, and `FRONTEND_ORIGIN` during development; production must have the required values above. For local development, copy [api/.env.example](api/.env.example) to `api/.env`, set `DATABASE_URL` and a random `SESSION_SECRET`, then copy [.env.example](.env.example) to `.env.local` and set `VITE_API_BASE_URL=http://localhost:3001`. The development-only in-memory `pg-mem` fallback loses data when the API restarts; do not use it for deployment.

### Other provider-specific variables (not implemented)

There is no current KRA/eTIMS, bank-feed/open-banking, email-delivery, or statutory filing adapter. As a result, this app has no KRA, bank, SHIF, NSSF, or AHL credential variable names to list or enter; adding arbitrary variables cannot enable unavailable code. KRA/eTIMS requires appropriate KRA onboarding, device/API specification, certificates or credentials, and certification; bank feeds require choosing and onboarding a licensed provider; payroll filing requires reviewed calculations and an authorized filing route. Do not invent variable names or store unrelated credentials hoping to enable these systems. Store secrets only in server-side Render settings or an approved encrypted vault—not in `VITE_*`, source control, or README values.

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
