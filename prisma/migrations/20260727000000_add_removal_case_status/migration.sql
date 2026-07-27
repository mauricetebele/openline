-- Removal-case administration workflow.
-- Adds a status lifecycle plus Amazon case id and reimbursement id/amount to
-- FBA removal cases. Purely additive and non-destructive: existing rows default
-- to CASE_NOT_CREATED and the new columns are nullable.
--
-- Lifecycle:
--   CASE_NOT_CREATED (default) -> CASE_CREATED (amazonCaseId entered)
--     -> RESOLVED_REIMBURSED (reimbursementId + reimbursementAmount) OR REIMBURSEMENT_DENIED

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'RemovalCaseStatus') THEN
    CREATE TYPE "RemovalCaseStatus" AS ENUM (
      'CASE_NOT_CREATED',
      'CASE_CREATED',
      'REIMBURSEMENT_DENIED',
      'RESOLVED_REIMBURSED'
    );
  END IF;
END$$;

ALTER TABLE "fba_removal_cases"
  ADD COLUMN IF NOT EXISTS "status" "RemovalCaseStatus" NOT NULL DEFAULT 'CASE_NOT_CREATED',
  ADD COLUMN IF NOT EXISTS "amazonCaseId" TEXT,
  ADD COLUMN IF NOT EXISTS "reimbursementId" TEXT,
  ADD COLUMN IF NOT EXISTS "reimbursementAmount" DECIMAL(12,2);

CREATE INDEX IF NOT EXISTS "fba_removal_cases_status_idx" ON "fba_removal_cases" ("status");
