-- Optional per-serial battery health %, uploaded for in-stock units.
ALTER TABLE "inventory_serials" ADD COLUMN "batteryHealthPct" DOUBLE PRECISION;
