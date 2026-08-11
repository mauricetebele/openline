-- Vendor RMA return address — where vendor returns (RTV) ship to; auto-fills
-- shipping labels. Additive/non-destructive.

ALTER TABLE "vendors" ADD COLUMN IF NOT EXISTS "rmaName"     TEXT;
ALTER TABLE "vendors" ADD COLUMN IF NOT EXISTS "rmaCompany"  TEXT;
ALTER TABLE "vendors" ADD COLUMN IF NOT EXISTS "rmaAddress1" TEXT;
ALTER TABLE "vendors" ADD COLUMN IF NOT EXISTS "rmaAddress2" TEXT;
ALTER TABLE "vendors" ADD COLUMN IF NOT EXISTS "rmaCity"     TEXT;
ALTER TABLE "vendors" ADD COLUMN IF NOT EXISTS "rmaState"    TEXT;
ALTER TABLE "vendors" ADD COLUMN IF NOT EXISTS "rmaPostal"   TEXT;
ALTER TABLE "vendors" ADD COLUMN IF NOT EXISTS "rmaCountry"  TEXT DEFAULT 'US';
ALTER TABLE "vendors" ADD COLUMN IF NOT EXISTS "rmaPhone"    TEXT;
