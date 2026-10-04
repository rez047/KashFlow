CREATE TABLE IF NOT EXISTS workspace_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'admin',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, workspace_id)
);

CREATE TABLE IF NOT EXISTS workspace_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  email text,
  phone text,
  role text NOT NULL DEFAULT 'viewer',
  scope text NOT NULL DEFAULT 'single' CHECK (scope IN ('single', 'all_owned')),
  invited_by uuid REFERENCES users(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS workspace_members_user_idx ON workspace_members (user_id);
CREATE INDEX IF NOT EXISTS workspace_members_workspace_idx ON workspace_members (workspace_id);
CREATE INDEX IF NOT EXISTS workspace_invitations_workspace_idx ON workspace_invitations (workspace_id, status);

