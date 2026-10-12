ALTER TABLE workspaces
  ADD COLUMN IF NOT EXISTS archived_at timestamptz;
