-- History of physical scans in the BH Sorting Tool: when a device was scanned,
-- the battery health % read, and the verdict.
CREATE TABLE IF NOT EXISTS "bh_scan_events" (
  "id"               TEXT NOT NULL,
  "serialNumber"     TEXT NOT NULL,
  "batteryHealthPct" DOUBLE PRECISION,
  "verdict"          TEXT NOT NULL,
  "threshold"        INTEGER,
  "sku"              TEXT,
  "model"            TEXT,
  "grade"            TEXT,
  "scannedById"      TEXT,
  "scannedByEmail"   TEXT,
  "scannedAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "bh_scan_events_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "bh_scan_events_scannedAt_idx" ON "bh_scan_events"("scannedAt");
CREATE INDEX IF NOT EXISTS "bh_scan_events_serialNumber_idx" ON "bh_scan_events"("serialNumber");
