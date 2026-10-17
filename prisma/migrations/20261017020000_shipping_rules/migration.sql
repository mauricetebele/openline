-- Back Market shipping logic rulesets (if/then), mapped to package presets.
CREATE TABLE IF NOT EXISTS "shipping_rules" (
    "id"                  TEXT NOT NULL,
    "name"                TEXT NOT NULL,
    "priority"            INTEGER NOT NULL DEFAULT 0,
    "active"              BOOLEAN NOT NULL DEFAULT true,
    "orderSource"         TEXT NOT NULL DEFAULT 'backmarket',
    "packagePresetId"     TEXT,
    "transitEnabled"      BOOLEAN NOT NULL DEFAULT false,
    "transitMaxDays"      INTEGER DEFAULT 2,
    "transitWithin"       BOOLEAN NOT NULL DEFAULT true,
    "valueEnabled"        BOOLEAN NOT NULL DEFAULT false,
    "valueOperator"       TEXT,
    "valueAmount"         DECIMAL(12,2),
    "thenCarrierType"     TEXT NOT NULL,
    "thenCarrierCode"     TEXT,
    "thenServiceCode"     TEXT NOT NULL,
    "thenServiceName"     TEXT,
    "thenUpsCredentialId" TEXT,
    "createdAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"           TIMESTAMP(3) NOT NULL,
    CONSTRAINT "shipping_rules_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "shipping_rules_active_priority_idx" ON "shipping_rules"("active", "priority");
DO $$ BEGIN
  ALTER TABLE "shipping_rules" ADD CONSTRAINT "shipping_rules_packagePresetId_fkey"
    FOREIGN KEY ("packagePresetId") REFERENCES "package_presets"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
