-- Manual threat override: dismiss an auto-refund / lost-in-transit threat handled outside the system.
ALTER TABLE "mfn_returns" ADD COLUMN "threatArchivedAt" TIMESTAMP(3);
ALTER TABLE "mfn_returns" ADD COLUMN "threatArchivedByLabel" TEXT;
ALTER TABLE "mfn_returns" ADD COLUMN "threatArchiveNote" TEXT;
