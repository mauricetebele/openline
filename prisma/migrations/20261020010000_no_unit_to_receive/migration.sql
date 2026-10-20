-- "No Unit To Receive": units accounted for by a case with no physical unit returned.
ALTER TABLE "removal_shipment_items" ADD COLUMN IF NOT EXISTS "noUnitToReceiveQty" INTEGER NOT NULL DEFAULT 0;
