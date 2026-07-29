-- Back Market pricing: store each listing's current price and its listing_id (needed
-- to push price updates) on MarketplaceListing. Additive/non-destructive.

ALTER TABLE "marketplace_listings"
  ADD COLUMN IF NOT EXISTS "price" DECIMAL(12,2),
  ADD COLUMN IF NOT EXISTS "bmListingRef" INTEGER;
