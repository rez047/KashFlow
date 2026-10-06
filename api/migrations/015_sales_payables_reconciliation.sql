CREATE TABLE IF NOT EXISTS estimates (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  customer text NOT NULL,
  customer_email text NOT NULL DEFAULT '',
  description text NOT NULL,
  amount numeric(14, 2) NOT NULL CHECK (amount > 0),
  valid_until date NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'sent', 'accepted', 'declined', 'converted', 'void')),
  invoice_id uuid REFERENCES invoices(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS estimates_workspace_idx ON estimates (workspace_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS vendor_bills (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  supplier text NOT NULL,
  description text NOT NULL,
  amount numeric(14, 2) NOT NULL CHECK (amount > 0),
  bill_date date NOT NULL,
  due_date date NOT NULL,
  status text NOT NULL DEFAULT 'unpaid' CHECK (status IN ('unpaid', 'paid', 'void')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS vendor_bills_workspace_idx ON vendor_bills (workspace_id, status, due_date);

CREATE TABLE IF NOT EXISTS bank_reconciliations (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  account_label text NOT NULL,
  period_start date NOT NULL,
  period_end date NOT NULL,
  opening_balance numeric(14, 2) NOT NULL,
  statement_ending_balance numeric(14, 2) NOT NULL,
  status text NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'completed')),
  completed_by uuid REFERENCES users(id) ON DELETE SET NULL,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (period_start <= period_end)
);
CREATE INDEX IF NOT EXISTS bank_reconciliations_workspace_idx ON bank_reconciliations (workspace_id, period_end DESC);

CREATE TABLE IF NOT EXISTS bank_reconciliation_matches (
  reconciliation_id uuid NOT NULL REFERENCES bank_reconciliations(id) ON DELETE CASCADE,
  transaction_id uuid NOT NULL REFERENCES ledger_transactions(id) ON DELETE RESTRICT,
  matched_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (reconciliation_id, transaction_id),
  UNIQUE (transaction_id)
);

INSERT INTO workspace_accounts (id, workspace_id, code, name, account_type)
SELECT gen_random_uuid(), workspace_id, '2200', 'Accounts payable', 'liability'
FROM workspace_accounts
GROUP BY workspace_id
ON CONFLICT (workspace_id, code) DO NOTHING;
