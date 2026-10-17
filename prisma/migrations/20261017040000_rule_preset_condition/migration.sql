-- Package preset becomes an IF condition (order's applied preset == X) rather
-- than a box mapping on the rule.
ALTER TABLE "shipping_rules" ADD COLUMN IF NOT EXISTS "presetEnabled" BOOLEAN NOT NULL DEFAULT false;
