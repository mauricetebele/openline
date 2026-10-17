-- Preset condition supports multiple presets (X or Y or Z).
ALTER TABLE "shipping_rules" ADD COLUMN IF NOT EXISTS "packagePresetIds" TEXT[] NOT NULL DEFAULT '{}';
-- Backfill from the old single-preset column, if present.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='shipping_rules' AND column_name='packagePresetId') THEN
    UPDATE "shipping_rules" SET "packagePresetIds" = ARRAY["packagePresetId"]
      WHERE "packagePresetId" IS NOT NULL AND "packagePresetIds" = '{}';
    ALTER TABLE "shipping_rules" DROP CONSTRAINT IF EXISTS "shipping_rules_packagePresetId_fkey";
    ALTER TABLE "shipping_rules" DROP COLUMN "packagePresetId";
  END IF;
END $$;
