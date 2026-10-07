CREATE TABLE IF NOT EXISTS vendor_bill_email_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  vendor_bill_id uuid NOT NULL REFERENCES vendor_bills(id) ON DELETE CASCADE,
  recipient text NOT NULL,
  provider text NOT NULL,
  status text NOT NULL CHECK (status IN ('accepted', 'failed')),
  provider_message_id text,
  failure_reason text,
  sent_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS vendor_bill_email_events_workspace_idx
  ON vendor_bill_email_events (workspace_id, created_at DESC);

CREATE INDEX IF NOT EXISTS vendor_bill_email_events_bill_idx
  ON vendor_bill_email_events (vendor_bill_id, created_at DESC);