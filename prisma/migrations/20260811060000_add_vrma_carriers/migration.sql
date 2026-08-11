-- Per-tracking carrier on a vendor return (a multi-box shipment can use
-- different carriers). Additive; backfill one carrier per existing tracking #.
ALTER TABLE "vendor_rmas" ADD COLUMN IF NOT EXISTS "carriers" TEXT[] NOT NULL DEFAULT '{}';
UPDATE "vendor_rmas"
  SET "carriers" = array_fill("carrier", ARRAY[cardinality("trackingNumbers")])
  WHERE "carrier" IS NOT NULL AND "carrier" <> ''
    AND cardinality("trackingNumbers") > 0 AND cardinality("carriers") = 0;
