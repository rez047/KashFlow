-- PesaPal Sabi wireless terminal notifications and verified POS payments.
-- Merchant credentials are encrypted; hashes allow the public webhook to identify
-- the business without decrypting every workspace credential set.

CREATE TABLE IF NOT EXISTS pesapal_sabi_connections (
  workspace_id uuid PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  consumer_key_hash text NOT NULL,
  consumer_secret_hash text NOT NULL,
  consumer_key_ciphertext text NOT NULL,
  consumer_secret_ciphertext text NOT NULL,
  verification_api_key_ciphertext text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (consumer_key_hash, consumer_secret_hash)
);

CREATE TABLE IF NOT EXISTS pesapal_terminal_payment_requests (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  invoice_id uuid NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  amount numeric(14, 2) NOT NULL CHECK (amount > 0),
  currency text NOT NULL CHECK (currency IN ('KES', 'USD')),
  reference text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'verification_required', 'failed')),
  idempotency_key uuid NOT NULL,
  provider_transaction_id text,
  confirmation_code text,
  payment_option text,
  result_description text,
  provider_result jsonb,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  callback_received_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, idempotency_key)
);

CREATE UNIQUE INDEX IF NOT EXISTS pesapal_terminal_transaction_id_idx
  ON pesapal_terminal_payment_requests (provider_transaction_id)
  WHERE provider_transaction_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS pesapal_terminal_confirmation_code_idx
  ON pesapal_terminal_payment_requests (confirmation_code)
  WHERE confirmation_code IS NOT NULL;

CREATE INDEX IF NOT EXISTS pesapal_terminal_workspace_invoice_idx
  ON pesapal_terminal_payment_requests (workspace_id, invoice_id, created_at DESC);
