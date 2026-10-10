-- Back Market BackBox "price_to_win" for our listing (from /backbox/v1/competitors).
-- Shown on the Marketplace SKUs grid under the BackBox price when we don't hold it.
ALTER TABLE "marketplace_listings" ADD COLUMN IF NOT EXISTS "backboxPriceToWin" DECIMAL(12,2);
