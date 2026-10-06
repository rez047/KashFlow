ALTER TABLE workspace_members
  ADD COLUMN IF NOT EXISTS permissions jsonb;

CREATE TABLE IF NOT EXISTS online_stores (
  workspace_id uuid PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  slug text NOT NULL UNIQUE,
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  enabled boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS online_store_orders (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending_review',
  source text NOT NULL DEFAULT 'store',
  external_order_id text,
  customer_name text NOT NULL,
  customer_email text NOT NULL,
  customer_phone text NOT NULL DEFAULT '',
  portal_token_hash text NOT NULL,
  total numeric(14, 2) NOT NULL,
  invoice_id uuid REFERENCES invoices(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, source, external_order_id),
  UNIQUE (portal_token_hash)
);
CREATE INDEX IF NOT EXISTS online_store_orders_workspace_idx
  ON online_store_orders (workspace_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS online_store_order_lines (
  id uuid PRIMARY KEY,
  order_id uuid NOT NULL REFERENCES online_store_orders(id) ON DELETE CASCADE,
  item_id uuid REFERENCES workspace_records(id) ON DELETE SET NULL,
  product_name text NOT NULL,
  sku text NOT NULL DEFAULT '',
  quantity numeric(14, 3) NOT NULL,
  unit_price numeric(14, 2) NOT NULL,
  total numeric(14, 2) NOT NULL
);

CREATE TABLE IF NOT EXISTS woocommerce_connections (
  workspace_id uuid PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  store_url text NOT NULL,
  consumer_key_ciphertext text NOT NULL,
  consumer_secret_ciphertext text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  last_order_id text,
  last_synced_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS woocommerce_product_mappings (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  item_id uuid NOT NULL REFERENCES workspace_records(id) ON DELETE CASCADE,
  external_product_id text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, item_id),
  UNIQUE (workspace_id, external_product_id)
);
