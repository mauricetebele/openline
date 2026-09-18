-- Ask AI assistant settings on store_settings
ALTER TABLE "store_settings"
  ADD COLUMN IF NOT EXISTS "anthropicApiKeyEnc" TEXT,
  ADD COLUMN IF NOT EXISTS "aiModel" TEXT;
