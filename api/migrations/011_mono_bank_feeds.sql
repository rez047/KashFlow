CREATE TABLE IF NOT EXISTS connected_bank_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  provider text NOT NULL DEFAULT 'mono',
  provider_account_id text NOT NULL,
  account_name text NOT NULL DEFAULT '',
  account_number_masked text NOT NULL DEFAULT '',
  institution_name text NOT NULL DEFAULT '',
  currency text NOT NULL DEFAULT 'KES',
  account_type text NOT NULL DEFAULT '',
  data_status text NOT NULL DEFAULT 'PROCESSING',
  connection_status text NOT NULL DEFAULT 'connected' CHECK (connection_status IN ('connected', 'reauthorization_required', 'disconnected')),
  last_synced_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, provider, provider_account_id)
);
CREATE INDEX IF NOT EXISTS connected_bank_accounts_sync_idx ON connected_bank_accounts (connection_status, last_synced_at);

CREATE TABLE IF NOT EXISTS bank_feed_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  connected_account_id uuid NOT NULL REFERENCES connected_bank_accounts(id) ON DELETE CASCADE,
  provider_transaction_id text NOT NULL,
  transaction_date date NOT NULL,
  narration text NOT NULL DEFAULT '',
  amount numeric(14, 2) NOT NULL CHECK (amount >= 0),
  direction text NOT NULL CHECK (direction IN ('income', 'expense')),
  currency text NOT NULL DEFAULT 'KES',
  review_status text NOT NULL DEFAULT 'needs_review' CHECK (review_status IN ('needs_review', 'ignored', 'posted')),
  posted_transaction_id uuid REFERENCES ledger_transactions(id) ON DELETE SET NULL,
  provider_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (connected_account_id, provider_transaction_id)
);
CREATE INDEX IF NOT EXISTS bank_feed_transactions_workspace_date_idx ON bank_feed_transactions (workspace_id, transaction_date DESC);
CREATE INDEX IF NOT EXISTS bank_feed_transactions_review_idx ON bank_feed_transactions (workspace_id, review_status, transaction_date DESC);
