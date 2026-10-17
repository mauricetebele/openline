-- Per-order resolution notes & archive state for the BM Unpaid Orders report.
CREATE TABLE IF NOT EXISTS "bm_unpaid_resolutions" (
    "id"         TEXT NOT NULL,
    "orderId"    TEXT NOT NULL,
    "note"       TEXT,
    "solvedAt"   TIMESTAMP(3),
    "archived"   BOOLEAN NOT NULL DEFAULT false,
    "archivedAt" TIMESTAMP(3),
    "updatedBy"  TEXT,
    "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"  TIMESTAMP(3) NOT NULL,
    CONSTRAINT "bm_unpaid_resolutions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "bm_unpaid_resolutions_orderId_key" ON "bm_unpaid_resolutions"("orderId");
CREATE INDEX IF NOT EXISTS "bm_unpaid_resolutions_archived_idx" ON "bm_unpaid_resolutions"("archived");
