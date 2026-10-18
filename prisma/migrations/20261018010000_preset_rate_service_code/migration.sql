-- Carrier service CODE for rule-applied orders (presetRateService holds the name).
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "presetRateServiceCode" TEXT;
