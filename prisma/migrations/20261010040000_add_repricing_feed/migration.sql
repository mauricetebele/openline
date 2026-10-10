-- Repricing suggestion feed: per ASIN+condition strategy + decision log
-- (approve/reject; rejections snooze the triggering rule for 24h).
CREATE TABLE IF NOT EXISTS "repricing_group_settings" (
  "id" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "asin" TEXT NOT NULL,
  "itemCondition" TEXT NOT NULL,
  "strategy" TEXT NOT NULL DEFAULT 'STANDARD',
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "repricing_group_settings_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "repricing_group_settings_accountId_asin_itemCondition_key"
  ON "repricing_group_settings" ("accountId", "asin", "itemCondition");

CREATE TABLE IF NOT EXISTS "repricing_decisions" (
  "id" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "asin" TEXT NOT NULL,
  "itemCondition" TEXT NOT NULL,
  "rule" TEXT NOT NULL,
  "strategy" TEXT NOT NULL,
  "decision" TEXT NOT NULL,
  "currentPrice" DECIMAL(12,2),
  "suggestedPrice" DECIMAL(12,2),
  "finalPrice" DECIMAL(12,2),
  "marginCurrent" DECIMAL(7,2),
  "marginFinal" DECIMAL(7,2),
  "snapshot" JSONB,
  "pushResults" JSONB,
  "note" TEXT,
  "decidedBy" TEXT,
  "decidedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "snoozeUntil" TIMESTAMP(3),
  CONSTRAINT "repricing_decisions_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "repricing_decisions_accountId_asin_itemCondition_decidedAt_idx"
  ON "repricing_decisions" ("accountId", "asin", "itemCondition", "decidedAt");
