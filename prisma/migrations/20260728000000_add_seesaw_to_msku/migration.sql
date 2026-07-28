-- SEE-SAW: alternate which marketplace gets the LAST unit for a (productId, gradeId)
-- group, flipping every 12 hours. A default-on alternative to isDefaultSku
-- ("Last Unit Lean"); mutually exclusive with it within a group.
-- Purely additive / non-destructive.

ALTER TABLE "product_grade_marketplace_skus"
  ADD COLUMN IF NOT EXISTS "seeSaw" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "seeSawActive" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "seeSawFlippedAt" TIMESTAMP;

-- Groups that already use Last Unit Lean keep that strategy (see-saw off), to
-- preserve existing behaviour and the see-saw/lean mutual exclusion.
UPDATE "product_grade_marketplace_skus" s
SET "seeSaw" = false
FROM (
  SELECT DISTINCT "productId", "gradeId"
  FROM "product_grade_marketplace_skus"
  WHERE "isDefaultSku" = true
) g
WHERE s."productId" = g."productId"
  AND (s."gradeId" IS NOT DISTINCT FROM g."gradeId");
