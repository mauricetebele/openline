-- FBA customer returns: keep the report's "reason" column (shown as Refund Reason
-- on Review Amazon Refunds for FBA orders).
ALTER TABLE "fba_returns" ADD COLUMN IF NOT EXISTS "reason" TEXT;
