-- Store the Amazon merchant_shipping_group id (UUID) captured by the live listing
-- pull, so a listing's shipping template can be resolved to its display name even
-- when it's missing from the (stale) catalog report. Additive/non-destructive.

ALTER TABLE "seller_listings"
  ADD COLUMN IF NOT EXISTS "shippingTemplateGroupId" TEXT;
