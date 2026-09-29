-- Repair receiving: record when a unit was received back and where it moved to.
ALTER TABLE "repair_order_items" ADD COLUMN "receivedAt" TIMESTAMP(3);
ALTER TABLE "repair_order_items" ADD COLUMN "receivedLocationId" TEXT;

CREATE INDEX "repair_order_items_receivedLocationId_idx" ON "repair_order_items"("receivedLocationId");

ALTER TABLE "repair_order_items" ADD CONSTRAINT "repair_order_items_receivedLocationId_fkey"
  FOREIGN KEY ("receivedLocationId") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
