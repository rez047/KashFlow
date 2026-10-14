-- Manual M-Pesa receipt verification. A user can type an M-Pesa receipt number against an
-- invoice; the server verifies it against Daraja's Transaction Status API and only marks the
-- invoice paid when the receipt exists and the amount equals the full outstanding balance.
--
-- `origin` distinguishes a customer-prompted STK request from a manually entered receipt.
-- `mpesa_reference` stores the receipt number the user typed so we can search and audit it.
-- The status list gains 'verification_required' so a receipt that Daraja cannot yet confirm
-- (pending, not found, or amount mismatch) never counts as income.
ALTER TABLE mpesa_payment_requests
  ADD COLUMN IF NOT EXISTS origin text NOT NULL DEFAULT 'stk' CHECK (origin IN ('stk', 'manual')),
  ADD COLUMN IF NOT EXISTS mpesa_reference text;

ALTER TABLE mpesa_payment_requests DROP CONSTRAINT IF EXISTS mpesa_payment_requests_status_check;
ALTER TABLE mpesa_payment_requests
  ADD CONSTRAINT mpesa_payment_requests_status_check
  CHECK (status IN ('initiating', 'pending', 'paid', 'failed', 'verification_required'));

-- A receipt number can only be recorded once per workspace, so the same M-Pesa receipt cannot
-- be applied to two invoices. Partial indexes keep STK rows (no receipt yet) unconstrained.
CREATE UNIQUE INDEX IF NOT EXISTS mpesa_payment_requests_workspace_reference_idx
  ON mpesa_payment_requests (workspace_id, mpesa_reference)
  WHERE mpesa_reference IS NOT NULL;
