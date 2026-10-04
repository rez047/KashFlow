CREATE TABLE IF NOT EXISTS workspace_accounts (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  code text NOT NULL,
  name text NOT NULL,
  account_type text NOT NULL CHECK (account_type IN ('asset', 'liability', 'equity', 'income', 'expense')),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, code)
);

CREATE TABLE IF NOT EXISTS journal_entries (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  entry_date date NOT NULL,
  description text NOT NULL,
  source_type text NOT NULL DEFAULT 'manual',
  source_id uuid,
  posted_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS journal_entries_workspace_date_idx ON journal_entries (workspace_id, entry_date DESC);

CREATE TABLE IF NOT EXISTS journal_lines (
  id uuid PRIMARY KEY,
  journal_entry_id uuid NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES workspace_accounts(id),
  description text,
  debit numeric(14, 2) NOT NULL DEFAULT 0 CHECK (debit >= 0),
  credit numeric(14, 2) NOT NULL DEFAULT 0 CHECK (credit >= 0),
  CHECK ((debit > 0 AND credit = 0) OR (credit > 0 AND debit = 0))
);
CREATE INDEX IF NOT EXISTS journal_lines_entry_idx ON journal_lines (journal_entry_id);

CREATE TABLE IF NOT EXISTS accounting_periods (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  period text NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  closed_by uuid REFERENCES users(id) ON DELETE SET NULL,
  closed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, period)
);

CREATE TABLE IF NOT EXISTS audit_events (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  event_type text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid,
  event_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_events_workspace_created_idx ON audit_events (workspace_id, created_at DESC);

CREATE TABLE IF NOT EXISTS employees (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  employee_data_encrypted text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS employees_workspace_active_idx ON employees (workspace_id, active);

CREATE TABLE IF NOT EXISTS payroll_runs (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  period text NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'posted', 'paid')),
  rule_set text NOT NULL,
  employee_count integer NOT NULL DEFAULT 0,
  gross_total numeric(14, 2) NOT NULL DEFAULT 0,
  net_total numeric(14, 2) NOT NULL DEFAULT 0,
  paye_total numeric(14, 2) NOT NULL DEFAULT 0,
  shif_total numeric(14, 2) NOT NULL DEFAULT 0,
  nssf_employee_total numeric(14, 2) NOT NULL DEFAULT 0,
  nssf_employer_total numeric(14, 2) NOT NULL DEFAULT 0,
  housing_employee_total numeric(14, 2) NOT NULL DEFAULT 0,
  housing_employer_total numeric(14, 2) NOT NULL DEFAULT 0,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, period)
);
CREATE INDEX IF NOT EXISTS payroll_runs_workspace_period_idx ON payroll_runs (workspace_id, period DESC);

CREATE TABLE IF NOT EXISTS payroll_run_items (
  id uuid PRIMARY KEY,
  payroll_run_id uuid NOT NULL REFERENCES payroll_runs(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES employees(id),
  payslip_encrypted text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (payroll_run_id, employee_id)
);

CREATE TABLE IF NOT EXISTS payroll_remittances (
  id uuid PRIMARY KEY,
  payroll_run_id uuid NOT NULL REFERENCES payroll_runs(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  remittance_type text NOT NULL CHECK (remittance_type IN ('paye', 'shif', 'nssf', 'housing_levy')),
  amount numeric(14, 2) NOT NULL CHECK (amount >= 0),
  status text NOT NULL DEFAULT 'due' CHECK (status IN ('due', 'recorded_paid')),
  payment_reference text,
  recorded_by uuid REFERENCES users(id) ON DELETE SET NULL,
  recorded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (payroll_run_id, remittance_type)
);
