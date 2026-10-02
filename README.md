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
