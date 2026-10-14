-- Per-business credentials and callback correlation for asynchronous Daraja
-- Transaction Status lookups. The status-query security credential is supplied
-- pre-encrypted with Safaricom's environment-specific public certificate.
ALTER TABLE daraja_connections
  ADD COLUMN IF NOT EXISTS initiator_name text,
  ADD COLUMN IF NOT EXISTS initiator_security_credential_ciphertext text;

ALTER TABLE mpesa_payment_requests
  ADD COLUMN IF NOT EXISTS transaction_status_conversation_id text,
  ADD COLUMN IF NOT EXISTS transaction_status_originator_id text;

CREATE UNIQUE INDEX IF NOT EXISTS mpesa_payment_requests_status_conversation_idx
  ON mpesa_payment_requests (transaction_status_conversation_id)
  WHERE transaction_status_conversation_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS mpesa_payment_requests_status_originator_idx
  ON mpesa_payment_requests (transaction_status_originator_id)
  WHERE transaction_status_originator_id IS NOT NULL;
