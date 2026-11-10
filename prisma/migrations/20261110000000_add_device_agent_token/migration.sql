CREATE TABLE IF NOT EXISTS "device_agent_tokens" (
  "id"         TEXT NOT NULL,
  "token"      TEXT NOT NULL,
  "userId"     TEXT NOT NULL,
  "label"      TEXT,
  "lastSeenAt" TIMESTAMP(3),
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "device_agent_tokens_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "device_agent_tokens_token_key" ON "device_agent_tokens"("token");
CREATE INDEX IF NOT EXISTS "device_agent_tokens_userId_idx" ON "device_agent_tokens"("userId");
