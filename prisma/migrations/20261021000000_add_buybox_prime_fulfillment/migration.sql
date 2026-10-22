ALTER TABLE "seller_listings" ADD COLUMN IF NOT EXISTS "buyBoxIsPrime" BOOLEAN;
ALTER TABLE "seller_listings" ADD COLUMN IF NOT EXISTS "buyBoxFulfillment" TEXT;
