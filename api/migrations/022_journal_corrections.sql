ALTER TABLE journal_entries
  ADD COLUMN IF NOT EXISTS reversal_of uuid REFERENCES journal_entries(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS correction_reason text;

CREATE UNIQUE INDEX IF NOT EXISTS journal_entries_single_reversal_idx
  ON journal_entries (reversal_of)
  WHERE reversal_of IS NOT NULL;
