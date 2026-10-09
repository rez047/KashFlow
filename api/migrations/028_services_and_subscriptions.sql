-- 028: services as first-class records, plus per-customer service subscriptions.
--
-- 007 created workspace_records with a CHECK that only allowed
-- customer/supplier/inventory/project. The services feature therefore failed at the
-- database level even though the API schema accepted it. Widen the constraint so a
-- service is stored the same way as any other record type.
ALTER TABLE workspace_records DROP CONSTRAINT IF EXISTS workspace_records_constraint_1;
ALTER TABLE workspace_records
  ADD CONSTRAINT workspace_records_record_type_check
  CHECK (record_type IN ('customer', 'supplier', 'inventory', 'service', 'project'));

-- Which customer subscribes to which service, on what cycle, and at what rate.
-- rate_source records whether the line bills the business's consumer rate, the plain
-- renewal rate, or a one-off custom amount agreed with that customer.
CREATE TABLE IF NOT EXISTS service_subscriptions (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  service_id uuid NOT NULL REFERENCES workspace_records(id) ON DELETE RESTRICT,
  customer_id uuid REFERENCES workspace_records(id) ON DELETE SET NULL,
  customer_name text NOT NULL CHECK (length(customer_name) BETWEEN 1 AND 160),
  customer_email text NOT NULL DEFAULT '',
  customer_phone text NOT NULL DEFAULT '',
  rate_source text NOT NULL DEFAULT 'consumer' CHECK (rate_source IN ('consumer', 'renewal', 'custom')),
  custom_rate numeric(14, 2) NOT NULL DEFAULT 0 CHECK (custom_rate >= 0),
  billing_cycle text NOT NULL DEFAULT 'monthly' CHECK (billing_cycle IN ('none', 'monthly', 'quarterly', 'annually')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'cancelled')),
  payment_preference text NOT NULL DEFAULT 'either' CHECK (payment_preference IN ('cash', 'mpesa', 'either')),
  recurring_template_id uuid REFERENCES recurring_templates(id) ON DELETE SET NULL,
  start_date date NOT NULL,
  next_invoice_date date,
  notes text NOT NULL DEFAULT '',
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, service_id, customer_id)
);
CREATE INDEX IF NOT EXISTS service_subscriptions_service_idx
  ON service_subscriptions (workspace_id, service_id, status);
CREATE INDEX IF NOT EXISTS service_subscriptions_due_idx
  ON service_subscriptions (workspace_id, status, next_invoice_date);
