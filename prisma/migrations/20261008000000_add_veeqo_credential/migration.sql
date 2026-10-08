-- Veeqo shipping integration credential (encrypted x-api-key).
CREATE TABLE IF NOT EXISTS "veeqo_credentials" (
  "id"           TEXT NOT NULL,
  "apiKeyEnc"    TEXT NOT NULL,
  "nickname"     TEXT,
  "isActive"     BOOLEAN NOT NULL DEFAULT true,
  "lastTestedAt" TIMESTAMP(3),
  "lastTestOk"   BOOLEAN,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "veeqo_credentials_pkey" PRIMARY KEY ("id")
);
