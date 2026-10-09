-- Older invitation code temporarily stored SMS invite numbers in the email column.
-- Move those values to the dedicated contact column before new invite links are used.
UPDATE workspace_invitations
SET phone = email,
    email = NULL
WHERE phone IS NULL
  AND email IS NOT NULL
  AND email !~* '^[^@]+@[^@]+$';
