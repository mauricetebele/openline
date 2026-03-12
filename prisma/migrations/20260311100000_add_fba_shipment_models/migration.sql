-- CreateEnum
CREATE TYPE "FbaShipmentStatus" AS ENUM ('DRAFT', 'PLAN_CREATED', 'PACKING_SET', 'PLACEMENT_CONFIRMED', 'TRANSPORT_CONFIRMED', 'LABELS_READY', 'SHIPPED', 'CANCELLED');

-- AlterTable: Add address fields to warehouses
ALTER TABLE "warehouses" ADD COLUMN "addressLine1" TEXT;
ALTER TABLE "warehouses" ADD COLUMN "addressLine2" TEXT;
ALTER TABLE "warehouses" ADD COLUMN "city" TEXT;
ALTER TABLE "warehouses" ADD COLUMN "state" TEXT;
ALTER TABLE "warehouses" ADD COLUMN "postalCode" TEXT;
ALTER TABLE "warehouses" ADD COLUMN "countryCode" TEXT NOT NULL DEFAULT 'US';

-- AlterTable: Add fnsku to product_grade_marketplace_skus
ALTER TABLE "product_grade_marketplace_skus" ADD COLUMN "fnsku" TEXT;

-- CreateTable: fba_shipments
CREATE TABLE "fba_shipments" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "status" "FbaShipmentStatus" NOT NULL DEFAULT 'DRAFT',
    "name" TEXT,
    "inboundPlanId" TEXT,
    "shipmentId" TEXT,
    "shipmentConfirmationId" TEXT,
    "packingOptionId" TEXT,
    "packingGroupId" TEXT,
    "placementOptionId" TEXT,
    "transportOptionId" TEXT,
    "deliveryWindowOptionId" TEXT,
    "placementFee" DECIMAL(12,2),
    "shippingEstimate" DECIMAL(12,2),
    "labelData" TEXT,
    "lastError" TEXT,
    "lastErrorAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fba_shipments_pkey" PRIMARY KEY ("id")
);

-- CreateTable: fba_shipment_items
CREATE TABLE "fba_shipment_items" (
    "id" TEXT NOT NULL,
    "shipmentId" TEXT NOT NULL,
    "mskuId" TEXT NOT NULL,
    "sellerSku" TEXT NOT NULL,
    "fnsku" TEXT NOT NULL,
    "asin" TEXT,
    "quantity" INT NOT NULL,

    CONSTRAINT "fba_shipment_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable: fba_shipment_boxes
CREATE TABLE "fba_shipment_boxes" (
    "id" TEXT NOT NULL,
    "shipmentId" TEXT NOT NULL,
    "boxNumber" INT NOT NULL,
    "weightLb" DECIMAL(8,2) NOT NULL,
    "lengthIn" DECIMAL(8,2) NOT NULL,
    "widthIn" DECIMAL(8,2) NOT NULL,
    "heightIn" DECIMAL(8,2) NOT NULL,

    CONSTRAINT "fba_shipment_boxes_pkey" PRIMARY KEY ("id")
);

-- CreateTable: fba_shipment_box_items
CREATE TABLE "fba_shipment_box_items" (
    "id" TEXT NOT NULL,
    "boxId" TEXT NOT NULL,
    "shipmentItemId" TEXT NOT NULL,
    "quantity" INT NOT NULL,

    CONSTRAINT "fba_shipment_box_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable: fba_inventory_reservations
CREATE TABLE "fba_inventory_reservations" (
    "id" TEXT NOT NULL,
    "fbaShipmentId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "gradeId" TEXT,
    "qtyReserved" INT NOT NULL,
    "reservedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fba_inventory_reservations_pkey" PRIMARY KEY ("id")
);

-- CreateIndexes
CREATE INDEX "fba_shipments_accountId_idx" ON "fba_shipments"("accountId");
CREATE INDEX "fba_shipments_status_idx" ON "fba_shipments"("status");
CREATE INDEX "fba_shipment_items_shipmentId_idx" ON "fba_shipment_items"("shipmentId");
CREATE INDEX "fba_shipment_boxes_shipmentId_idx" ON "fba_shipment_boxes"("shipmentId");
CREATE UNIQUE INDEX "fba_shipment_boxes_shipmentId_boxNumber_key" ON "fba_shipment_boxes"("shipmentId", "boxNumber");
CREATE UNIQUE INDEX "fba_shipment_box_items_boxId_shipmentItemId_key" ON "fba_shipment_box_items"("boxId", "shipmentItemId");
CREATE INDEX "fba_inventory_reservations_fbaShipmentId_idx" ON "fba_inventory_reservations"("fbaShipmentId");

-- AddForeignKeys
ALTER TABLE "fba_shipments" ADD CONSTRAINT "fba_shipments_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "amazon_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "fba_shipments" ADD CONSTRAINT "fba_shipments_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "fba_shipment_items" ADD CONSTRAINT "fba_shipment_items_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "fba_shipments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "fba_shipment_items" ADD CONSTRAINT "fba_shipment_items_mskuId_fkey" FOREIGN KEY ("mskuId") REFERENCES "product_grade_marketplace_skus"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "fba_shipment_boxes" ADD CONSTRAINT "fba_shipment_boxes_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "fba_shipments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "fba_shipment_box_items" ADD CONSTRAINT "fba_shipment_box_items_boxId_fkey" FOREIGN KEY ("boxId") REFERENCES "fba_shipment_boxes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "fba_shipment_box_items" ADD CONSTRAINT "fba_shipment_box_items_shipmentItemId_fkey" FOREIGN KEY ("shipmentItemId") REFERENCES "fba_shipment_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "fba_inventory_reservations" ADD CONSTRAINT "fba_inventory_reservations_fbaShipmentId_fkey" FOREIGN KEY ("fbaShipmentId") REFERENCES "fba_shipments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "fba_inventory_reservations" ADD CONSTRAINT "fba_inventory_reservations_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "fba_inventory_reservations" ADD CONSTRAINT "fba_inventory_reservations_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "fba_inventory_reservations" ADD CONSTRAINT "fba_inventory_reservations_gradeId_fkey" FOREIGN KEY ("gradeId") REFERENCES "grades"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill FNSKU from seller_listings to product_grade_marketplace_skus
UPDATE "product_grade_marketplace_skus" msku
SET "fnsku" = sl."fnsku"
FROM "seller_listings" sl
WHERE sl."sku" = msku."sellerSku"
  AND sl."fnsku" IS NOT NULL
  AND msku."fnsku" IS NULL
  AND msku."marketplace" = 'amazon';
