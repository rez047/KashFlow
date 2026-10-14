CREATE TABLE IF NOT EXISTS api_idempotency_keys (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  idempotency_key uuid NOT NULL,
  request_hash text NOT NULL,
  status text NOT NULL DEFAULT 'processing' CHECK (status IN ('processing', 'complete', 'unknown')),
  response_status integer,
  response_body jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, user_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS api_idempotency_keys_created_at_idx
  ON api_idempotency_keys (created_at);
