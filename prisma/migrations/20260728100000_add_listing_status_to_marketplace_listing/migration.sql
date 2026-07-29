-- Active/Inactive indicator for marketplace listings (used by the Back Market tab).
-- For Back Market, derived from stock quantity > 0 during sync. Additive/non-destructive.

ALTER TABLE "marketplace_listings"
  ADD COLUMN IF NOT EXISTS "listingStatus" TEXT;
