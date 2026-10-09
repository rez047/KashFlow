-- Service supplier coverage and customer-specific service payments.
ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS service_subscription_id uuid REFERENCES service_subscriptions(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS invoices_service_subscription_idx
  ON invoices (workspace_id, service_subscription_id, due_date DESC);

ALTER TABLE invoice_payments
  ADD COLUMN IF NOT EXISTS payment_method text NOT NULL DEFAULT 'cash';
ALTER TABLE invoice_payments
  ADD COLUMN IF NOT EXISTS payment_reference text NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS service_supplier_payments (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  service_id uuid NOT NULL REFERENCES workspace_records(id) ON DELETE RESTRICT,
  supplier_id uuid REFERENCES workspace_records(id) ON DELETE SET NULL,
  amount numeric(14, 2) NOT NULL CHECK (amount > 0),
  payment_date date NOT NULL,
  billing_cycle text NOT NULL DEFAULT 'none' CHECK (billing_cycle IN ('none', 'monthly', 'quarterly', 'annually')),
  covered_until date,
  expense_recorded boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS service_supplier_payments_service_idx
  ON service_supplier_payments (workspace_id, service_id, payment_date DESC);
