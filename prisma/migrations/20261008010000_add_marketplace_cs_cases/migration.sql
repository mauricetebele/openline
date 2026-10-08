-- Marketplace Customer Service: new role + case/ticketing tables.
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'MARKETPLACE_CS';

DO $$ BEGIN
  CREATE TYPE "CsCaseStatus" AS ENUM ('OPEN', 'RESOLVED');
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE TABLE IF NOT EXISTS "cs_cases" (
  "id"              TEXT NOT NULL,
  "caseNumber"      SERIAL NOT NULL,
  "orderId"         TEXT,
  "status"          "CsCaseStatus" NOT NULL DEFAULT 'OPEN',
  "createdById"     TEXT NOT NULL,
  "resolvedAt"      TIMESTAMP(3),
  "resolvedById"    TEXT,
  "lastMessageAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastMessageById" TEXT,
  "agentReadAt"     TIMESTAMP(3),
  "adminReadAt"     TIMESTAMP(3),
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "cs_cases_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "cs_cases_caseNumber_key" ON "cs_cases"("caseNumber");
CREATE INDEX IF NOT EXISTS "cs_cases_status_idx" ON "cs_cases"("status");
CREATE INDEX IF NOT EXISTS "cs_cases_createdById_idx" ON "cs_cases"("createdById");

CREATE TABLE IF NOT EXISTS "cs_case_messages" (
  "id"          TEXT NOT NULL,
  "caseId"      TEXT NOT NULL,
  "authorId"    TEXT NOT NULL,
  "body"        TEXT NOT NULL,
  "attachments" JSONB,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "cs_case_messages_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "cs_case_messages_caseId_idx" ON "cs_case_messages"("caseId");
