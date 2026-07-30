-- Target-margin pricing: per-MSKU target net margin %. When set, the grid computes
-- a price that realizes this margin and can push it (with confirmation). Additive.

ALTER TABLE "product_grade_marketplace_skus"
  ADD COLUMN IF NOT EXISTS "targetMarginPct" DECIMAL(5,2);
