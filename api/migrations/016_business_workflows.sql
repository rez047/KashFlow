ALTER TABLE invoices ADD COLUMN IF NOT EXISTS amount_paid numeric(14, 2) NOT NULL DEFAULT 0 CHECK (amount_paid >= 0);
ALTER TABLE vendor_bills ADD COLUMN IF NOT EXISTS amount_paid numeric(14, 2) NOT NULL DEFAULT 0 CHECK (amount_paid >= 0);
ALTER TABLE vendor_bills ADD COLUMN IF NOT EXISTS approval_status text NOT NULL DEFAULT 'approved' CHECK (approval_status IN ('pending', 'approved', 'rejected'));
ALTER TABLE vendor_bills ADD COLUMN IF NOT EXISTS approved_by uuid REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE vendor_bills ADD COLUMN IF NOT EXISTS approved_at timestamptz;
ALTER TABLE workspace_invitations ADD COLUMN IF NOT EXISTS token_hash text;
ALTER TABLE workspace_invitations ADD COLUMN IF NOT EXISTS expires_at timestamptz;
ALTER TABLE workspace_invitations ADD COLUMN IF NOT EXISTS accepted_at timestamptz;
UPDATE invoices SET amount_paid = amount WHERE status = 'paid' AND amount_paid = 0;
UPDATE vendor_bills SET amount_paid = amount WHERE status = 'paid' AND amount_paid = 0;

CREATE TABLE IF NOT EXISTS invoice_payments (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  invoice_id uuid NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT,
  amount numeric(14, 2) NOT NULL CHECK (amount > 0),
  payment_date date NOT NULL,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS invoice_payments_invoice_idx ON invoice_payments (workspace_id, invoice_id, payment_date);

CREATE TABLE IF NOT EXISTS invoice_lines (
  id uuid PRIMARY KEY,
  invoice_id uuid NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  line_number integer NOT NULL,
  item_id uuid REFERENCES workspace_records(id) ON DELETE RESTRICT,
  description text NOT NULL,
  quantity numeric(14, 3) NOT NULL CHECK (quantity > 0),
  unit_price numeric(14, 2) NOT NULL CHECK (unit_price >= 0),
  discount_amount numeric(14, 2) NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
  tax_amount numeric(14, 2) NOT NULL DEFAULT 0 CHECK (tax_amount >= 0),
  total_amount numeric(14, 2) NOT NULL CHECK (total_amount >= 0),
  UNIQUE (invoice_id, line_number)
);
CREATE TABLE IF NOT EXISTS estimate_lines (
  id uuid PRIMARY KEY,
  estimate_id uuid NOT NULL REFERENCES estimates(id) ON DELETE CASCADE,
  line_number integer NOT NULL,
  item_id uuid REFERENCES workspace_records(id) ON DELETE RESTRICT,
  description text NOT NULL,
  quantity numeric(14, 3) NOT NULL CHECK (quantity > 0),
  unit_price numeric(14, 2) NOT NULL CHECK (unit_price >= 0),
  discount_amount numeric(14, 2) NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
  tax_amount numeric(14, 2) NOT NULL DEFAULT 0 CHECK (tax_amount >= 0),
  total_amount numeric(14, 2) NOT NULL CHECK (total_amount >= 0),
  UNIQUE (estimate_id, line_number)
);
CREATE TABLE IF NOT EXISTS vendor_bill_lines (
  id uuid PRIMARY KEY,
  bill_id uuid NOT NULL REFERENCES vendor_bills(id) ON DELETE CASCADE,
  line_number integer NOT NULL,
  description text NOT NULL,
  quantity numeric(14, 3) NOT NULL CHECK (quantity > 0),
  unit_price numeric(14, 2) NOT NULL CHECK (unit_price >= 0),
  discount_amount numeric(14, 2) NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
  tax_amount numeric(14, 2) NOT NULL DEFAULT 0 CHECK (tax_amount >= 0),
  recoverable_tax_amount numeric(14, 2) NOT NULL DEFAULT 0 CHECK (recoverable_tax_amount >= 0 AND recoverable_tax_amount <= tax_amount),
  total_amount numeric(14, 2) NOT NULL CHECK (total_amount >= 0),
  UNIQUE (bill_id, line_number)
);
INSERT INTO invoice_lines (id, invoice_id, line_number, description, quantity, unit_price, total_amount)
SELECT gen_random_uuid(), id, 1, description, 1, amount, amount FROM invoices
ON CONFLICT (invoice_id, line_number) DO NOTHING;
INSERT INTO estimate_lines (id, estimate_id, line_number, description, quantity, unit_price, total_amount)
SELECT gen_random_uuid(), id, 1, description, 1, amount, amount FROM estimates
ON CONFLICT (estimate_id, line_number) DO NOTHING;
INSERT INTO vendor_bill_lines (id, bill_id, line_number, description, quantity, unit_price, total_amount)
SELECT gen_random_uuid(), id, 1, description, 1, amount, amount FROM vendor_bills
ON CONFLICT (bill_id, line_number) DO NOTHING;

CREATE TABLE IF NOT EXISTS bill_payments (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  bill_id uuid NOT NULL REFERENCES vendor_bills(id) ON DELETE RESTRICT,
  amount numeric(14, 2) NOT NULL CHECK (amount > 0),
  payment_date date NOT NULL,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS bill_payments_bill_idx ON bill_payments (workspace_id, bill_id, payment_date);

CREATE TABLE IF NOT EXISTS inventory_movements (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  item_id uuid NOT NULL REFERENCES workspace_records(id) ON DELETE RESTRICT,
  movement_type text NOT NULL CHECK (movement_type IN ('opening', 'purchase', 'sale', 'adjustment')),
  quantity_delta numeric(14, 3) NOT NULL CHECK (quantity_delta <> 0),
  unit_cost numeric(14, 2) NOT NULL CHECK (unit_cost >= 0),
  reference text NOT NULL DEFAULT '',
  moved_at date NOT NULL,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS inventory_movements_item_idx ON inventory_movements (workspace_id, item_id, moved_at DESC);

CREATE TABLE IF NOT EXISTS purchase_orders (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  supplier text NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'partially_received', 'received', 'cancelled')),
  order_date date NOT NULL,
  due_date date,
  expected_date date,
  notes text NOT NULL DEFAULT '',
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS purchase_order_lines (
  id uuid PRIMARY KEY,
  purchase_order_id uuid NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  item_id uuid NOT NULL REFERENCES workspace_records(id) ON DELETE RESTRICT,
  quantity numeric(14, 3) NOT NULL CHECK (quantity > 0),
  received_quantity numeric(14, 3) NOT NULL DEFAULT 0 CHECK (received_quantity >= 0),
  unit_cost numeric(14, 2) NOT NULL CHECK (unit_cost >= 0)
);
CREATE INDEX IF NOT EXISTS purchase_orders_workspace_idx ON purchase_orders (workspace_id, order_date DESC);

CREATE TABLE IF NOT EXISTS project_time_entries (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES workspace_records(id) ON DELETE RESTRICT,
  description text NOT NULL,
  work_date date NOT NULL,
  hours numeric(8, 2) NOT NULL CHECK (hours > 0 AND hours <= 24),
  hourly_cost numeric(14, 2) NOT NULL CHECK (hourly_cost >= 0),
  billable boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted', 'approved', 'rejected')),
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  reviewed_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS project_time_entries_project_idx ON project_time_entries (workspace_id, project_id, work_date);

CREATE TABLE IF NOT EXISTS workspace_budgets (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  account_code text NOT NULL,
  period text NOT NULL CHECK (length(period) = 7),
  amount numeric(14, 2) NOT NULL CHECK (amount >= 0),
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, account_code, period)
);
CREATE INDEX IF NOT EXISTS workspace_budgets_period_idx ON workspace_budgets (workspace_id, period);

CREATE TABLE IF NOT EXISTS recurring_templates (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  template_type text NOT NULL CHECK (template_type IN ('invoice', 'expense')),
  description text NOT NULL,
  counterparty text NOT NULL DEFAULT '',
  amount numeric(14, 2) NOT NULL CHECK (amount > 0),
  account text NOT NULL DEFAULT 'Operating expenses',
  frequency text NOT NULL CHECK (frequency IN ('monthly', 'quarterly', 'annually')),
  next_date date NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS recurring_templates_due_idx ON recurring_templates (workspace_id, active, next_date);

INSERT INTO workspace_accounts (id, workspace_id, code, name, account_type)
SELECT gen_random_uuid(), workspace_id, '1200', 'Inventory on hand', 'asset'
FROM workspace_accounts
GROUP BY workspace_id
ON CONFLICT (workspace_id, code) DO NOTHING;
INSERT INTO workspace_accounts (id, workspace_id, code, name, account_type)
SELECT gen_random_uuid(), workspace_id, '5100', 'Cost of goods sold', 'expense'
FROM workspace_accounts
GROUP BY workspace_id
ON CONFLICT (workspace_id, code) DO NOTHING;
INSERT INTO workspace_accounts (id, workspace_id, code, name, account_type)
SELECT gen_random_uuid(), workspace_id, '1300', 'Recoverable purchase tax', 'asset'
FROM workspace_accounts
GROUP BY workspace_id
ON CONFLICT (workspace_id, code) DO NOTHING;
INSERT INTO workspace_accounts (id, workspace_id, code, name, account_type)
SELECT gen_random_uuid(), workspace_id, '2150', 'Sales tax payable', 'liability'
FROM workspace_accounts
GROUP BY workspace_id
ON CONFLICT (workspace_id, code) DO NOTHING;
