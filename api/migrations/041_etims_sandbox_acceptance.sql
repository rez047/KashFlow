ALTER TABLE compliance_submission_drafts
  DROP CONSTRAINT IF EXISTS compliance_submission_drafts_provider_status_check;

ALTER TABLE compliance_submission_drafts
  ADD CONSTRAINT compliance_submission_drafts_provider_status_check
  CHECK (provider_status IN (
    'blocked_no_certified_adapter',
    'ready_for_provider_review',
    'submission_unknown',
    'submitted_to_kra',
    'accepted_by_kra',
    'accepted_in_sandbox',
    'rejected_by_kra'
  ));
