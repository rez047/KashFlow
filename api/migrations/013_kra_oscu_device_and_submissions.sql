CREATE TABLE IF NOT EXISTS kra_oscu_workspaces (
  workspace_id uuid PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  credentials_encrypted text NOT NULL,
  environment text NOT NULL CHECK (environment IN ('sandbox', 'production')),
  device_id text,
  sdc_id text,
  mrc_no text,
  initialized_at timestamptz,
  last_code_sync_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS kra_oscu_invoice_counters (
  workspace_id uuid PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  last_invoice_number bigint NOT NULL DEFAULT 0
);
UPDATE integration_onboarding SET details = details - 'taxpayerPin' WHERE integration_type = 'kra_etims';

ALTER TABLE compliance_submission_drafts
  ADD COLUMN IF NOT EXISTS provider_result jsonb,
  ADD COLUMN IF NOT EXISTS external_invoice_number text,
  ADD COLUMN IF NOT EXISTS fiscal_receipt_signature text,
  ADD COLUMN IF NOT EXISTS provider_submitted_at timestamptz;

ALTER TABLE compliance_submission_drafts DROP CONSTRAINT IF EXISTS compliance_submission_drafts_provider_status_check;
ALTER TABLE compliance_submission_drafts ADD CONSTRAINT compliance_submission_drafts_provider_status_check
  CHECK (provider_status IN ('blocked_no_certified_adapter', 'ready_for_provider_review', 'submission_unknown', 'submitted_to_kra', 'accepted_by_kra', 'rejected_by_kra'));
