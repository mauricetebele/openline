-- Ship-from company name shown on labels (separate from the internal warehouse
-- name). Additive.
ALTER TABLE "warehouses" ADD COLUMN IF NOT EXISTS "companyName" TEXT;
