ALTER TABLE email_delivery_events
  ADD COLUMN IF NOT EXISTS estimate_id uuid REFERENCES estimates(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS email_delivery_events_estimate_idx
  ON email_delivery_events (workspace_id, estimate_id, created_at DESC);

ALTER TABLE recurring_templates
  ADD COLUMN IF NOT EXISTS customer_email text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS customer_phone text NOT NULL DEFAULT '';
