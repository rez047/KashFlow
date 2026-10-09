-- 028: services as first-class records, plus per-customer service subscriptions.
--
-- 007 created workspace_records with an INLINE, unnamed CHECK on record_type allowing only
-- customer/supplier/inventory/project, so a service was rejected by the database even though
-- the API schema accepted it. PostgreSQL auto-names an inline column check as
-- "<table>_<column>_check", so the constraint to drop here is workspace_records_record_type_check.
--
-- Drop every candidate name defensively (a hand-named 007 or a re-run may differ) so this
-- migration is safe to apply on any database that already has the narrower constraint.
ALTER TABLE workspace_records DROP CONSTRAINT IF EXISTS workspace_records_record_type_check;
ALTER TABLE workspace_records DROP CONSTRAINT IF EXISTS workspace_records_constraint_1;
ALTER TABLE workspace_records DROP CONSTRAINT IF EXISTS workspace_records_record_type_check1;

-- Only add the widened constraint when an equivalent one is not already in place, so
-- re-running this migration stays idempotent.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'workspace_records'::regclass AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%service%'
  ) THEN
    ALTER TABLE workspace_records
      ADD CONSTRAINT workspace_records_record_type_check
      CHECK (record_type IN ('customer', 'supplier', 'inventory', 'service', 'project'));
  END IF;
END $$;

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
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS service_subscriptions_service_idx
  ON service_subscriptions (workspace_id, service_id, status);
CREATE INDEX IF NOT EXISTS service_subscriptions_due_idx
  ON service_subscriptions (workspace_id, status, next_invoice_date);
-- One subscription per customer per service. Declared as a partial-safe unique index rather
-- than a table constraint so a cancelled subscription can be removed and re-added cleanly.
CREATE UNIQUE INDEX IF NOT EXISTS service_subscriptions_unique_customer_idx
  ON service_subscriptions (workspace_id, service_id, customer_id)
  WHERE customer_id IS NOT NULL;
