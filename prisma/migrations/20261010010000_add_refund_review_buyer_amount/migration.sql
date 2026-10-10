-- Review Amazon Refunds: amount refunded to the buyer (incl. sales tax), so the
-- screen matches Amazon's refund notification email alongside our net cost.
ALTER TABLE "amazon_refund_reviews" ADD COLUMN IF NOT EXISTS "buyerRefundAmount" DECIMAL(12,2);
ALTER TABLE "amazon_refund_reviews" ADD COLUMN IF NOT EXISTS "buyerRefundCheckedAt" TIMESTAMP(3);
