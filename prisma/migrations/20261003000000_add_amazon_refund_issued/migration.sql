-- Audit trail of refunds issued to Amazon via the OrderAdjustment feed, and the
-- guard used to block double-refunding the same order.
CREATE TABLE IF NOT EXISTS "amazon_refunds_issued" (
  "id"            TEXT NOT NULL,
  "accountId"     TEXT NOT NULL,
  "orderId"       TEXT NOT NULL,
  "amazonOrderId" TEXT NOT NULL,
  "amount"        DECIMAL(12,2) NOT NULL,
  "currency"      TEXT NOT NULL DEFAULT 'USD',
  "reason"        TEXT NOT NULL,
  "feedId"        TEXT,
  "feedStatus"    TEXT,
  "feedResult"    TEXT,
  "issuedById"    TEXT,
  "issuedByEmail" TEXT,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "amazon_refunds_issued_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "amazon_refunds_issued_amazonOrderId_idx" ON "amazon_refunds_issued"("amazonOrderId");
CREATE INDEX IF NOT EXISTS "amazon_refunds_issued_orderId_idx" ON "amazon_refunds_issued"("orderId");
