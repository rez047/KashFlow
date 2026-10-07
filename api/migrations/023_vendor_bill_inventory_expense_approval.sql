ALTER TABLE vendor_bills
  ADD COLUMN IF NOT EXISTS inventory_expense_requested boolean NOT NULL DEFAULT false;