-- VelocityScore: price-change timestamp per listing + per-check samples of live
-- SKUs (price, Buy Box held) for Buy Box share.
ALTER TABLE "seller_listings" ADD COLUMN IF NOT EXISTS "priceChangedAt" TIMESTAMP(3);

CREATE TABLE IF NOT EXISTS "listing_uptime_samples" (
  "id" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "sku" TEXT NOT NULL,
  "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "price" DECIMAL(12,2),
  "holdsBuyBox" BOOLEAN,
  CONSTRAINT "listing_uptime_samples_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "listing_uptime_samples_sku_at_idx" ON "listing_uptime_samples" ("sku", "at");
