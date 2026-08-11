-- Shipping labels purchased for vendor returns (RTV). Pieces bought together
-- share a labelSetId; each piece is one row. Additive.

CREATE TABLE IF NOT EXISTS "vendor_return_labels" (
  "id"              TEXT PRIMARY KEY,
  "vendorRmaId"     TEXT NOT NULL REFERENCES "vendor_rmas"("id") ON DELETE CASCADE,
  "labelSetId"      TEXT NOT NULL,
  "carrier"         TEXT NOT NULL,
  "serviceCode"     TEXT,
  "serviceLabel"    TEXT,
  "shipmentId"      TEXT,
  "trackingNumber"  TEXT NOT NULL,
  "pieceNumber"     INTEGER NOT NULL DEFAULT 1,
  "pieceCount"      INTEGER NOT NULL DEFAULT 1,
  "labelData"       TEXT NOT NULL,
  "labelFormat"     TEXT NOT NULL DEFAULT 'pdf',
  "shipmentCost"    DECIMAL(12,2),
  "currency"        TEXT DEFAULT 'USD',
  "upsCredentialId" TEXT,
  "shipFrom"        JSONB,
  "shipTo"          JSONB,
  "voided"          BOOLEAN NOT NULL DEFAULT false,
  "voidedAt"        TIMESTAMP,
  "createdAt"       TIMESTAMP NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "vendor_return_labels_vendorRmaId_idx" ON "vendor_return_labels" ("vendorRmaId");
CREATE INDEX IF NOT EXISTS "vendor_return_labels_labelSetId_idx" ON "vendor_return_labels" ("labelSetId");
CREATE INDEX IF NOT EXISTS "vendor_return_labels_trackingNumber_idx" ON "vendor_return_labels" ("trackingNumber");
