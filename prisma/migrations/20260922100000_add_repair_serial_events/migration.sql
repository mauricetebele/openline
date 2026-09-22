-- Distinct serial-history events for repair activity (ship-out / return).
ALTER TYPE "SerialEventType" ADD VALUE IF NOT EXISTS 'REPAIR_SHIPPED';
ALTER TYPE "SerialEventType" ADD VALUE IF NOT EXISTS 'REPAIR_RETURNED';
