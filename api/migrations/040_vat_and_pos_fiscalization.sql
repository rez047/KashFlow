ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS sale_channel text NOT NULL DEFAULT 'manual';

ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_sale_channel_check;
ALTER TABLE invoices ADD CONSTRAINT invoices_sale_channel_check
  CHECK (sale_channel IN ('manual', 'pos'));

ALTER TABLE invoice_lines
  ADD COLUMN IF NOT EXISTS vat_treatment text NOT NULL DEFAULT 'unclassified';

ALTER TABLE invoice_lines
  ADD COLUMN IF NOT EXISTS etims_item_code text,
  ADD COLUMN IF NOT EXISTS etims_item_class_code text,
  ADD COLUMN IF NOT EXISTS etims_package_unit_code text,
  ADD COLUMN IF NOT EXISTS etims_quantity_unit_code text;

ALTER TABLE invoice_lines DROP CONSTRAINT IF EXISTS invoice_lines_vat_treatment_check;
ALTER TABLE invoice_lines ADD CONSTRAINT invoice_lines_vat_treatment_check
  CHECK (vat_treatment IN ('B16', 'A_EXEMPT', 'C_ZERO', 'D_OUT_OF_SCOPE', 'E_NON_VATABLE', 'unclassified'));

ALTER TABLE vendor_bill_lines
  ADD COLUMN IF NOT EXISTS vat_treatment text NOT NULL DEFAULT 'unclassified';

ALTER TABLE vendor_bill_lines DROP CONSTRAINT IF EXISTS vendor_bill_lines_vat_treatment_check;
ALTER TABLE vendor_bill_lines ADD CONSTRAINT vendor_bill_lines_vat_treatment_check
  CHECK (vat_treatment IN ('B16', 'A_EXEMPT', 'C_ZERO', 'D_OUT_OF_SCOPE', 'E_NON_VATABLE', 'unclassified'));

CREATE INDEX IF NOT EXISTS invoices_workspace_sale_channel_date_idx
  ON invoices (workspace_id, sale_channel, created_at DESC);
