-- Optional device unlock code / passcode stored per serial. Populated via the
-- Unlock Codes bulk paste tool; shown on the Serial # Lookup modal and as an
-- optional column on the Serial Search grid.
ALTER TABLE "inventory_serials" ADD COLUMN IF NOT EXISTS "unlockCode" TEXT;
