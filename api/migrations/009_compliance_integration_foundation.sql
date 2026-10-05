CREATE TABLE IF NOT EXISTS integration_onboarding (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  integration_type text NOT NULL CHECK (integration_type IN ('kra_etims', 'bank_feeds', 'statutory_filing')),
  milestone text NOT NULL DEFAULT 'not_started' CHECK (milestone IN ('not_started', 'application_in_progress', 'sandbox_testing', 'certification_review', 'certified')),
  self_reported_note text NOT NULL DEFAULT '',
  updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, integration_type)
);

CREATE TABLE IF NOT EXISTS compliance_submission_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  integration_type text NOT NULL CHECK (integration_type IN ('kra_etims', 'statutory_filing')),
  source_type text NOT NULL CHECK (source_type IN ('invoice', 'payroll_run')),
  source_id uuid NOT NULL,
  payload_version text NOT NULL,
  draft_payload jsonb NOT NULL,
  workflow_status text NOT NULL DEFAULT 'draft' CHECK (workflow_status IN ('draft', 'reviewed', 'cancelled')),
  provider_status text NOT NULL DEFAULT 'blocked_no_certified_adapter' CHECK (provider_status IN ('blocked_no_certified_adapter', 'ready_for_provider_review')),
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, integration_type, source_type, source_id)
);
CREATE INDEX IF NOT EXISTS compliance_submission_drafts_workspace_idx ON compliance_submission_drafts (workspace_id, created_at DESC);
