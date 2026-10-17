-- Manual attribution of Lost_Inbound reimbursements to an inbound shipment
-- (Amazon's reimbursement report carries no shipment id, only a case-id).
ALTER TABLE "fba_reimbursements" ADD COLUMN IF NOT EXISTS "attributedShipmentId" TEXT;
ALTER TABLE "fba_reimbursements" ADD COLUMN IF NOT EXISTS "attributedAt" TIMESTAMP(3);
ALTER TABLE "fba_reimbursements" ADD COLUMN IF NOT EXISTS "attributedById" TEXT;
CREATE INDEX IF NOT EXISTS "fba_reimbursements_attributedShipmentId_idx" ON "fba_reimbursements"("attributedShipmentId");
DO $$ BEGIN
  ALTER TABLE "fba_reimbursements"
    ADD CONSTRAINT "fba_reimbursements_attributedShipmentId_fkey"
    FOREIGN KEY ("attributedShipmentId") REFERENCES "fba_shipments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
