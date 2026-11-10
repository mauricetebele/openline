CREATE TABLE IF NOT EXISTS "device_agent_commands" (
  "id"        TEXT NOT NULL,
  "userId"    TEXT NOT NULL,
  "type"      TEXT NOT NULL,
  "status"    TEXT NOT NULL DEFAULT 'PENDING',
  "udid"      TEXT,
  "result"    TEXT,
  "error"     TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "device_agent_commands_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "device_agent_commands_userId_status_idx" ON "device_agent_commands"("userId", "status");
