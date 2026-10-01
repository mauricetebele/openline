-- Order-processor flag asking the warehouse to serialize an order while it is
-- still unshipped. Drives the row highlight + badge on the fulfillment grid.
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "pleaseSerialize" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "pleaseSerializeAt" TIMESTAMP(3);
