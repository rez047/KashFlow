-- Ensure legacy user accounts remain members of their original workspace after
-- workspace membership enforcement was introduced. Existing membership rows,
-- including deliberately revoked memberships, are left unchanged.
INSERT INTO workspace_members (user_id, workspace_id, role)
SELECT id, workspace_id, 'admin' FROM users
ON CONFLICT (user_id, workspace_id) DO NOTHING;
