ALTER TABLE workspace_members DROP CONSTRAINT IF EXISTS workspace_members_role_check;
ALTER TABLE workspace_invitations DROP CONSTRAINT IF EXISTS workspace_invitations_role_check;

ALTER TABLE workspace_invitations ADD COLUMN IF NOT EXISTS scope text NOT NULL DEFAULT 'single';
ALTER TABLE workspace_invitations ADD COLUMN IF NOT EXISTS invited_by uuid REFERENCES users(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS invitation_workspaces (
  id uuid PRIMARY KEY,
  invitation_id uuid NOT NULL REFERENCES workspace_invitations(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS invitation_workspaces_workspace_idx ON invitation_workspaces (workspace_id);