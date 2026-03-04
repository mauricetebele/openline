-- Add archivedAt to products for soft-delete
ALTER TABLE "products" ADD COLUMN "archivedAt" TIMESTAMPTZ;

-- Add isSynced flag to marketplace SKUs
ALTER TABLE "product_grade_marketplace_skus" ADD COLUMN "isSynced" BOOLEAN NOT NULL DEFAULT false;

-- Create marketplace_listings table for synced listings
CREATE TABLE "marketplace_listings" (
    "id" TEXT NOT NULL,
    "marketplace" TEXT NOT NULL,
    "sellerSku" TEXT NOT NULL,
    "title" TEXT,
    "accountId" TEXT,
    "fulfillmentChannel" TEXT,
    "lastSyncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "mskuId" TEXT,

    CONSTRAINT "marketplace_listings_pkey" PRIMARY KEY ("id")
);

-- Unique index on mskuId (one-to-one with MSKU)
CREATE UNIQUE INDEX "marketplace_listings_mskuId_key" ON "marketplace_listings"("mskuId");

-- Unique index on marketplace + sellerSku + accountId
CREATE UNIQUE INDEX "marketplace_listings_marketplace_sellerSku_accountId_key" ON "marketplace_listings"("marketplace", "sellerSku", "accountId");

-- Foreign key to product_grade_marketplace_skus
ALTER TABLE "marketplace_listings" ADD CONSTRAINT "marketplace_listings_mskuId_fkey" FOREIGN KEY ("mskuId") REFERENCES "product_grade_marketplace_skus"("id") ON DELETE SET NULL ON UPDATE CASCADE;
