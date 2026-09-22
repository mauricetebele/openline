-- Map a repair vendor to a location: in-repair units move into this location
-- when shipped to the vendor.
ALTER TABLE "repair_vendors" ADD COLUMN "repairLocationId" TEXT;

CREATE INDEX "repair_vendors_repairLocationId_idx" ON "repair_vendors"("repairLocationId");

ALTER TABLE "repair_vendors" ADD CONSTRAINT "repair_vendors_repairLocationId_fkey"
  FOREIGN KEY ("repairLocationId") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
