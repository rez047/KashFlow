CREATE TABLE IF NOT EXISTS email_delivery_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  invoice_id uuid REFERENCES invoices(id) ON DELETE SET NULL,
  recipient text NOT NULL,
  provider text NOT NULL,
  status text NOT NULL CHECK (status IN ('accepted', 'failed')),
  provider_message_id text,
  failure_reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS email_delivery_events_workspace_idx ON email_delivery_events (workspace_id, created_at DESC);
