-- FBA Customer Returns: store customer comments on the return, and capture the
-- return reason + comments on the receipt (by LPN) at receive time.
ALTER TABLE "fba_returns" ADD COLUMN IF NOT EXISTS "customerComments" TEXT;
CREATE INDEX IF NOT EXISTS "fba_returns_lpn_idx" ON "fba_returns"("lpn");
ALTER TABLE "fba_return_receipts" ADD COLUMN IF NOT EXISTS "returnReason" TEXT;
ALTER TABLE "fba_return_receipts" ADD COLUMN IF NOT EXISTS "customerComments" TEXT;
CREATE INDEX IF NOT EXISTS "fba_return_receipts_lpnNumber_idx" ON "fba_return_receipts"("lpnNumber");
