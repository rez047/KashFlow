ALTER TABLE audit_events ADD COLUMN IF NOT EXISTS actor_display text;

CREATE INDEX IF NOT EXISTS audit_events_workspace_actor_created_idx
  ON audit_events (workspace_id, actor_user_id, created_at DESC);
