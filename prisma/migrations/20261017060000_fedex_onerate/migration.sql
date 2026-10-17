-- FedEx One Rate option on BM shipping rules (+ per-preset packaging map), and
-- the resolved One Rate choice persisted on the order.
ALTER TABLE "shipping_rules" ADD COLUMN IF NOT EXISTS "thenFedexOneRate" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "shipping_rules" ADD COLUMN IF NOT EXISTS "thenFedexPackaging" TEXT;
ALTER TABLE "shipping_rules" ADD COLUMN IF NOT EXISTS "thenFedexPackagingMap" JSONB;
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "presetRateFedexOneRate" BOOLEAN;
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "presetRateFedexPackaging" TEXT;
