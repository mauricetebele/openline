-- Default ship-from warehouse for shipping labels (exclusive). Additive.
ALTER TABLE "warehouses" ADD COLUMN IF NOT EXISTS "isDefault" BOOLEAN NOT NULL DEFAULT false;
