-- Amazon listing uptime tracking (cron/listing-uptime): current live state per
-- listing + a log of up/down transitions used for the repricing live window.
ALTER TABLE "seller_listings" ADD COLUMN IF NOT EXISTS "isLive" BOOLEAN;
ALTER TABLE "seller_listings" ADD COLUMN IF NOT EXISTS "uptimeCheckedAt" TIMESTAMP(3);

CREATE TABLE IF NOT EXISTS "listing_uptime_events" (
  "id" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "sku" TEXT NOT NULL,
  "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "live" BOOLEAN NOT NULL,
  "reason" TEXT,
  CONSTRAINT "listing_uptime_events_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "listing_uptime_events_accountId_sku_at_idx"
  ON "listing_uptime_events" ("accountId", "sku", "at");
