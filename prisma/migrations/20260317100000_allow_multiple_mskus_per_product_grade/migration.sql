-- Drop the old unique constraint (productId, gradeId, marketplace, accountId)
DROP INDEX IF EXISTS "product_grade_marketplace_skus_productId_gradeId_marketplace_accountId_key";

-- Drop the separate sellerSku index (now covered by the new unique constraint)
DROP INDEX IF EXISTS "product_grade_marketplace_skus_sellerSku_idx";

-- Add new unique constraint on (sellerSku, marketplace, accountId)
CREATE UNIQUE INDEX "product_grade_marketplace_skus_sellerSku_marketplace_accountId_key"
  ON "product_grade_marketplace_skus" ("sellerSku", "marketplace", "accountId");
