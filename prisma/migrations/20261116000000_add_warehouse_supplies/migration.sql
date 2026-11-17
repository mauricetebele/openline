CREATE TYPE "SupplyStatus" AS ENUM ('AMPLE', 'MODERATE', 'VERY_LOW', 'CRITICAL');

CREATE TABLE "warehouse_supplies" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "status" "SupplyStatus" NOT NULL DEFAULT 'AMPLE',
  "warehouseNote" TEXT,
  "adminNote" TEXT,
  "createdByLabel" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "warehouse_supplies_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "warehouse_supplies_status_idx" ON "warehouse_supplies"("status");
