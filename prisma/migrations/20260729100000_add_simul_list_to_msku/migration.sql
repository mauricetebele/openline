-- SIMUL-LIST: push the full available quantity to every marketplace at once (no
-- split), accepting oversell risk to maximize velocity. Mutually exclusive with
-- isDefaultSku (Last Unit Lean) and seeSaw. Additive/non-destructive.

ALTER TABLE "product_grade_marketplace_skus"
  ADD COLUMN IF NOT EXISTS "simulList" BOOLEAN NOT NULL DEFAULT false;
