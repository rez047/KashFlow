ALTER TABLE compliance_submission_drafts
  ADD COLUMN IF NOT EXISTS reviewer_name text,
  ADD COLUMN IF NOT EXISTS reviewer_qualification text,
  ADD COLUMN IF NOT EXISTS reviewer_reference text,
  ADD COLUMN IF NOT EXISTS reviewer_attested_at timestamptz;
