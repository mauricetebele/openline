-- Repair Orders
DO $$ BEGIN CREATE TYPE "RepairOrderStatus" AS ENUM ('DRAFT','SHIPPED_OUT','AT_VENDOR','RETURNED','COMPLETED','CANCELLED'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE "RepairItemStatus" AS ENUM ('PENDING','REPAIRED','REFUSED'); EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE TABLE IF NOT EXISTS repair_vendors (id TEXT PRIMARY KEY, "companyName" TEXT NOT NULL, email TEXT, phone TEXT, address1 TEXT, address2 TEXT, city TEXT, state TEXT, postal TEXT, country TEXT NOT NULL DEFAULT 'US', "isActive" BOOLEAN NOT NULL DEFAULT true, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT now());

CREATE TABLE IF NOT EXISTS repair_types (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, "isActive" BOOLEAN NOT NULL DEFAULT true, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT now());

CREATE TABLE IF NOT EXISTS repair_orders (id TEXT PRIMARY KEY, "orderNumber" SERIAL UNIQUE, "vendorId" TEXT NOT NULL REFERENCES repair_vendors(id) ON DELETE RESTRICT, status "RepairOrderStatus" NOT NULL DEFAULT 'DRAFT', notes TEXT, "outboundCarrier" TEXT, "outboundTracking" TEXT, "outboundShipmentId" TEXT, "inboundCarrier" TEXT, "inboundTracking" TEXT, "inboundShipmentId" TEXT, "createdById" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS repair_orders_vendorId_idx ON repair_orders("vendorId");
CREATE INDEX IF NOT EXISTS repair_orders_status_idx ON repair_orders(status);

CREATE TABLE IF NOT EXISTS repair_order_items (id TEXT PRIMARY KEY, "repairOrderId" TEXT NOT NULL REFERENCES repair_orders(id) ON DELETE CASCADE, "inventorySerialId" TEXT NOT NULL REFERENCES inventory_serials(id) ON DELETE RESTRICT, "repairTypeId" TEXT REFERENCES repair_types(id) ON DELETE SET NULL, "repairCost" DECIMAL(12,2), status "RepairItemStatus" NOT NULL DEFAULT 'PENDING', "repairSummary" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT now(), UNIQUE("repairOrderId","inventorySerialId"));
CREATE INDEX IF NOT EXISTS repair_order_items_serial_idx ON repair_order_items("inventorySerialId");
CREATE INDEX IF NOT EXISTS repair_order_items_type_idx ON repair_order_items("repairTypeId");
