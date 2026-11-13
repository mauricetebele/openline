-- First real carrier scan (package tendered to UPS); SLA clock start for lost-in-transit.
ALTER TABLE "mfn_returns" ADD COLUMN "tenderedAt" TIMESTAMP(3);
