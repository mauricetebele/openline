-- FBA inventory breakdown from the SP-API inventory summary, stored per seller
-- listing. quantity already holds the fulfillable (available) qty.
ALTER TABLE "seller_listings" ADD COLUMN IF NOT EXISTS "fbaReservedQty" INTEGER;
ALTER TABLE "seller_listings" ADD COLUMN IF NOT EXISTS "fbaTransferQty" INTEGER;
