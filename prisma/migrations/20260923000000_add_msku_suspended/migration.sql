-- Suspend Listing: force-push 0 qty to the marketplace regardless of on-hand.
ALTER TABLE "product_grade_marketplace_skus" ADD COLUMN "suspended" BOOLEAN NOT NULL DEFAULT false;
