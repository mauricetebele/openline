DO $$ BEGIN
  CREATE TYPE "BmCaseStatus" AS ENUM ('OPEN', 'RESOLVED');
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE TABLE IF NOT EXISTS "bm_cases" (
  "id"          TEXT NOT NULL,
  "caseId"      TEXT NOT NULL,
  "orderId"     TEXT,
  "description" TEXT NOT NULL,
  "caseUrl"     TEXT,
  "status"      "BmCaseStatus" NOT NULL DEFAULT 'OPEN',
  "resolvedAt"  TIMESTAMP(3),
  "createdBy"   TEXT,
  "updatedBy"   TEXT,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL,
  CONSTRAINT "bm_cases_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "bm_cases_status_idx" ON "bm_cases"("status");
CREATE INDEX IF NOT EXISTS "bm_cases_orderId_idx" ON "bm_cases"("orderId");
