-- Signature/confirmation requirement on a shipping rule, persisted on the order.
ALTER TABLE "shipping_rules" ADD COLUMN IF NOT EXISTS "thenConfirmation" TEXT;
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "presetRateConfirmation" TEXT;
