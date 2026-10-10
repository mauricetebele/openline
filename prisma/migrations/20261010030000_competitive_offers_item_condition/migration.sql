-- Competitive offers are now pulled per ASIN + Amazon ItemCondition (New / Used / …)
-- so Used listings get Used competitors. The unique key gains itemCondition so a
-- seller's New and Used offers on the same ASIN can both be stored.
ALTER TABLE "competitive_offers" ADD COLUMN IF NOT EXISTS "itemCondition" TEXT NOT NULL DEFAULT 'New';
DROP INDEX IF EXISTS "competitive_offers_accountId_asin_sellerId_fulfillmentType_key";
CREATE UNIQUE INDEX IF NOT EXISTS "competitive_offers_accountId_asin_itemCondition_sellerId_fulfillmentType_key"
  ON "competitive_offers" ("accountId", "asin", "itemCondition", "sellerId", "fulfillmentType");
