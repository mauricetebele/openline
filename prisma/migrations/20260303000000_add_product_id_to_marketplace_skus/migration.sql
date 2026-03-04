-- Step 1: Add productId column (nullable initially for backfill)
ALTER TABLE "product_grade_marketplace_skus" ADD COLUMN "productId" TEXT;

-- Step 2: Backfill productId from the grade's productId
UPDATE "product_grade_marketplace_skus" AS msku
SET "productId" = pg."productId"
FROM "product_grades" AS pg
WHERE msku."gradeId" = pg."id";

-- Step 3: Make productId NOT NULL now that all rows are backfilled
ALTER TABLE "product_grade_marketplace_skus" ALTER COLUMN "productId" SET NOT NULL;

-- Step 4: Make gradeId nullable
ALTER TABLE "product_grade_marketplace_skus" ALTER COLUMN "gradeId" DROP NOT NULL;

-- Step 5: Drop old unique constraint and create new one with productId
DROP INDEX IF EXISTS "product_grade_marketplace_skus_gradeId_marketplace_accountId_key";
CREATE UNIQUE INDEX "product_grade_marketplace_skus_productId_gradeId_marketplace_accountId_key"
ON "product_grade_marketplace_skus" ("productId", "gradeId", "marketplace", "accountId");

-- Step 6: Add foreign key to products
ALTER TABLE "product_grade_marketplace_skus"
ADD CONSTRAINT "product_grade_marketplace_skus_productId_fkey"
FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Step 7: Add partial unique index for ungraded rows (NULL gradeId)
-- PostgreSQL treats NULLs as distinct in unique constraints, so we need this
CREATE UNIQUE INDEX "pgms_ungraded_unique"
ON "product_grade_marketplace_skus" ("productId", "marketplace", COALESCE("accountId", '__NULL__'))
WHERE "gradeId" IS NULL;
