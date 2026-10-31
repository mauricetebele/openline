DO $$ BEGIN
  CREATE TYPE "CronRunStatus" AS ENUM ('RUNNING', 'COMPLETED', 'FAILED');
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE TABLE IF NOT EXISTS "cron_runs" (
  "id"              TEXT NOT NULL,
  "name"            TEXT NOT NULL,
  "status"          "CronRunStatus" NOT NULL DEFAULT 'RUNNING',
  "trigger"         TEXT NOT NULL DEFAULT 'cron',
  "startedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt"     TIMESTAMP(3),
  "durationMs"      INTEGER,
  "progressCurrent" INTEGER,
  "progressTotal"   INTEGER,
  "detail"          TEXT,
  "summary"         TEXT,
  "error"           TEXT,
  CONSTRAINT "cron_runs_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "cron_runs_name_startedAt_idx" ON "cron_runs"("name", "startedAt" DESC);
CREATE INDEX IF NOT EXISTS "cron_runs_status_idx" ON "cron_runs"("status");
