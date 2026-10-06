CREATE TABLE IF NOT EXISTS inventory_locations (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  code text NOT NULL CHECK (length(code) BETWEEN 1 AND 40),
  is_default boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, code)
);
CREATE UNIQUE INDEX IF NOT EXISTS inventory_locations_one_default_idx
  ON inventory_locations (workspace_id) WHERE is_default = true;

CREATE TABLE IF NOT EXISTS inventory_location_stock (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  location_id uuid NOT NULL REFERENCES inventory_locations(id) ON DELETE CASCADE,
  item_id uuid NOT NULL REFERENCES workspace_records(id) ON DELETE RESTRICT,
  quantity numeric(14, 3) NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, location_id, item_id)
);

ALTER TABLE inventory_movements ADD COLUMN IF NOT EXISTS location_id uuid REFERENCES inventory_locations(id) ON DELETE RESTRICT;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS location_id uuid REFERENCES inventory_locations(id) ON DELETE RESTRICT;
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS location_id uuid REFERENCES inventory_locations(id) ON DELETE RESTRICT;
ALTER TABLE invoice_lines ADD COLUMN IF NOT EXISTS returned_quantity numeric(14, 3) NOT NULL DEFAULT 0 CHECK (returned_quantity >= 0);
CREATE TABLE IF NOT EXISTS sales_returns (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  invoice_id uuid NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT,
  amount numeric(14, 2) NOT NULL CHECK (amount > 0),
  refund_amount numeric(14, 2) NOT NULL CHECK (refund_amount >= 0 AND refund_amount <= amount),
  reason text NOT NULL,
  return_date date NOT NULL,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sales_returns_invoice_idx ON sales_returns (workspace_id, invoice_id, return_date);

CREATE TABLE IF NOT EXISTS sales_return_lines (
  id uuid PRIMARY KEY,
  return_id uuid NOT NULL REFERENCES sales_returns(id) ON DELETE CASCADE,
  invoice_line_id uuid NOT NULL REFERENCES invoice_lines(id) ON DELETE RESTRICT,
  item_id uuid REFERENCES workspace_records(id) ON DELETE RESTRICT,
  quantity numeric(14, 3) NOT NULL CHECK (quantity > 0),
  amount numeric(14, 2) NOT NULL CHECK (amount > 0)
);

CREATE TABLE IF NOT EXISTS sales_orders (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  estimate_id uuid NOT NULL REFERENCES estimates(id) ON DELETE RESTRICT,
  invoice_id uuid REFERENCES invoices(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed', 'fulfilled', 'cancelled')),
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  fulfilled_at timestamptz,
  UNIQUE (workspace_id, estimate_id)
);
