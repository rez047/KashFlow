-- Recovery codes now use full alphanumeric entropy. Existing hashes used digits only,
-- so only legacy all-numeric eight-digit codes can be safely verified during migration.
ALTER TABLE user_recovery_codes
  ADD COLUMN IF NOT EXISTS hash_version integer NOT NULL DEFAULT 1;

-- The old hashes discarded recovery-code letters, making some codes guessable. Retire them
-- once; new codes are inserted with hash_version = 2 and are unaffected on later startups.
UPDATE user_recovery_codes
SET used_at = now()
WHERE hash_version = 1 AND used_at IS NULL;
