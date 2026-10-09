-- Idempotency receipts let offline clients safely retry counts after an interrupted
-- connection without posting the same stock adjustment twice.
CREATE TABLE IF NOT EXISTS inventory_count_submissions (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  idempotency_key uuid NOT NULL,
  payload_hash text NOT NULL CHECK (length(payload_hash) = 64),
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, idempotency_key)
);
