ALTER TABLE integration_onboarding
  ADD COLUMN IF NOT EXISTS details jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE compliance_submission_drafts
  ADD COLUMN IF NOT EXISTS reviewer_registration text,
  ADD COLUMN IF NOT EXISTS filing_route_details jsonb NOT NULL DEFAULT '{}'::jsonb;
