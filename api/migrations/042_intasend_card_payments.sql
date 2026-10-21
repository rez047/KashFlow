-- Hosted IntaSend card checkout for workspace POS sales.
--
-- Each workspace connects its own IntaSend account. The publishable key is encrypted
-- using the existing commerce credential key; card payment attempts are kept separate
-- from invoice_payments until the provider confirms a completed transaction.

CREATE TABLE IF NOT EXISTS intasend_connections (
  workspace_id uuid PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  publishable_key_ciphertext text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS intasend_card_payment_requests (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  invoice_id uuid NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  amount numeric(14, 2) NOT NULL CHECK (amount > 0),
  currency text NOT NULL CHECK (currency IN ('KES', 'USD', 'EUR', 'GBP')),
  status text NOT NULL DEFAULT 'initiating' CHECK (status IN ('initiating', 'pending', 'paid', 'failed', 'verification_required')),
  idempotency_key uuid NOT NULL,
  api_ref text NOT NULL UNIQUE,
  provider_invoice_id text,
  checkout_url text,
  provider_ref text,
  provider text,
  provider_charges numeric(14, 2) NOT NULL DEFAULT 0 CHECK (provider_charges >= 0),
  net_amount numeric(14, 2),
  result_description text,
  provider_result jsonb,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  callback_received_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, idempotency_key)
);

CREATE UNIQUE INDEX IF NOT EXISTS intasend_card_payment_provider_invoice_idx
  ON intasend_card_payment_requests (provider_invoice_id)
  WHERE provider_invoice_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS intasend_card_payment_workspace_invoice_idx
  ON intasend_card_payment_requests (workspace_id, invoice_id, created_at DESC);
