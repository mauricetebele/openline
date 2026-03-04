-- AlterTable
ALTER TABLE "seller_listings" ADD COLUMN "sold24h" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "seller_listings" ADD COLUMN "sold3d" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "seller_listings" ADD COLUMN "sold7d" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "seller_listings" ADD COLUMN "velocitySyncedAt" TIMESTAMP(3);
