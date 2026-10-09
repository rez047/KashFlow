-- Per-business Safaricom Daraja (M-Pesa) credentials.
--
-- Each business/workspace stores its own Daraja app credentials, encrypted with the
-- API-side ONLINE_COMMERCE_ENCRYPTION_KEY (AES-256-GCM), mirroring the WooCommerce
-- connection pattern. This lets different businesses use different merchant
-- shortcodes/apps instead of one shared set of server environment variables.
--
-- Plain SQL only (no DO $$ / PL/pgSQL) so the development pg-mem database can apply it.

CREATE TABLE IF NOT EXISTS daraja_connections (
  workspace_id uuid PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  consumer_key_ciphertext text NOT NULL,
  consumer_secret_ciphertext text NOT NULL,
  shortcode text NOT NULL CHECK (length(shortcode) BETWEEN 1 AND 20),
  passkey_ciphertext text NOT NULL,
  callback_url text NOT NULL,
  environment text NOT NULL DEFAULT 'sandbox' CHECK (environment IN ('sandbox', 'production')),
  transaction_type text NOT NULL DEFAULT 'CustomerPayBillOnline' CHECK (transaction_type IN ('CustomerPayBillOnline', 'CustomerBuyGoodsOnline')),
  enabled boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);
