-- Signed cookies remain valid for their normal lifetime unless the account's password changes.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS session_version integer NOT NULL DEFAULT 0;
