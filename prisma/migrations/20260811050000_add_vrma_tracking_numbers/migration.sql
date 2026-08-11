-- Support multiple tracking numbers on a vendor return. Additive; backfill the
-- array from the existing single trackingNumber.
ALTER TABLE "vendor_rmas" ADD COLUMN IF NOT EXISTS "trackingNumbers" TEXT[] NOT NULL DEFAULT '{}';
UPDATE "vendor_rmas"
  SET "trackingNumbers" = ARRAY["trackingNumber"]
  WHERE "trackingNumber" IS NOT NULL AND "trackingNumber" <> '' AND cardinality("trackingNumbers") = 0;
