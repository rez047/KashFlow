ALTER TABLE payroll_runs
  ADD COLUMN IF NOT EXISTS paid_total numeric(14, 2) NOT NULL DEFAULT 0 CHECK (paid_total >= 0);

UPDATE payroll_runs
SET paid_total = net_total
WHERE status = 'paid' AND paid_total = 0;

ALTER TABLE payroll_runs
  DROP CONSTRAINT IF EXISTS payroll_runs_status_check;

ALTER TABLE payroll_runs
  ADD CONSTRAINT payroll_runs_status_check CHECK (status IN ('draft', 'posted', 'partially_paid', 'paid'));

CREATE TABLE IF NOT EXISTS payroll_payments (
  id uuid PRIMARY KEY,
  payroll_run_id uuid NOT NULL REFERENCES payroll_runs(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  amount numeric(14, 2) NOT NULL CHECK (amount > 0),
  payment_reference text NOT NULL,
  payment_date date NOT NULL,
  recorded_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS payroll_payments_run_date_idx ON payroll_payments (payroll_run_id, payment_date DESC);
