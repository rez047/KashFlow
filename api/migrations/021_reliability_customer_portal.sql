CREATE TABLE IF NOT EXISTS invoice_idempotency_keys (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  idempotency_key text NOT NULL,
  request_hash text NOT NULL,
  invoice_id uuid REFERENCES invoices(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, idempotency_key),
  UNIQUE (invoice_id)
);

CREATE TABLE IF NOT EXISTS invoice_public_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  invoice_id uuid NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS invoice_public_links_workspace_invoice_idx
  ON invoice_public_links (workspace_id, invoice_id, expires_at DESC);

CREATE TABLE IF NOT EXISTS invoice_reminder_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  invoice_id uuid NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  recipient text NOT NULL,
  delivery_status text NOT NULL CHECK (delivery_status IN ('accepted', 'failed')),
  provider_message_id text,
  failure_reason text,
  sent_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS invoice_reminder_events_workspace_invoice_idx
  ON invoice_reminder_events (workspace_id, invoice_id, created_at DESC);
