CREATE TABLE IF NOT EXISTS mpesa_payment_requests (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  invoice_id uuid NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  customer_phone text NOT NULL,
  amount numeric(14, 2) NOT NULL CHECK (amount > 0),
  status text NOT NULL DEFAULT 'initiating' CHECK (status IN ('initiating', 'pending', 'paid', 'failed')),
  merchant_request_id text,
  checkout_request_id text UNIQUE,
  result_code text,
  result_description text,
  mpesa_receipt_number text,
  callback_received_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS mpesa_payment_requests_workspace_invoice_idx
  ON mpesa_payment_requests (workspace_id, invoice_id, created_at DESC);