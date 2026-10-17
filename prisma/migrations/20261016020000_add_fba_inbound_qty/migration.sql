-- Units inbound to Amazon (inboundWorking + inboundShipped + inboundReceiving)
-- from the SP-API FBA inventory summary. Null for MFN listings.
ALTER TABLE "seller_listings" ADD COLUMN IF NOT EXISTS "fbaInboundQty" INTEGER;
