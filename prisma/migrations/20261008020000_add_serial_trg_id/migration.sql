-- Optional TRG ID stored per serial. Populated via the TRG IDs bulk paste tool;
-- shown on the Serial # Lookup modal and as an optional column on the Serial Search grid.
ALTER TABLE "inventory_serials" ADD COLUMN IF NOT EXISTS "trgId" TEXT;
