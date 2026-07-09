-- Performance indexes — run MANUALLY against Neon during a quiet window.
--
-- These use CREATE INDEX CONCURRENTLY so they DON'T take a write lock on the
-- production tables (a plain CREATE INDEX, which `prisma db push`/`migrate`
-- would emit, locks the table for the duration of the build).
--
-- Index names match Prisma's default convention (<table>_<column>_idx) and are
-- mirrored by @@index lines in schema.prisma, so Prisma treats them as already
-- present and will NOT try to recreate them on the next generate/migrate.
--
-- CONCURRENTLY cannot run inside a transaction block — run each statement on its
-- own (psql: paste one at a time, or run the file with `psql -f` which auto-
-- commits each). If one fails mid-build it leaves an INVALID index; drop it and
-- retry: DROP INDEX CONCURRENTLY <name>;

-- order_items.sellerSku — filtered/sorted in orders grid, pick-list, match-by-sku
CREATE INDEX CONCURRENTLY IF NOT EXISTS "order_items_sellerSku_idx"
  ON order_items ("sellerSku");

-- orders.purchaseDate — default orders-grid sort
CREATE INDEX CONCURRENTLY IF NOT EXISTS "orders_purchaseDate_idx"
  ON orders ("purchaseDate");

-- orders.amazonOrderId — standalone lookups (return-label, rma, ss order-lookup)
CREATE INDEX CONCURRENTLY IF NOT EXISTS "orders_amazonOrderId_idx"
  ON orders ("amazonOrderId");

-- order_sync_jobs (accountId, status) — queried on every cron cycle (had ZERO indexes)
CREATE INDEX CONCURRENTLY IF NOT EXISTS "order_sync_jobs_accountId_status_idx"
  ON order_sync_jobs ("accountId", "status");

-- inventory_serials.serialNumber — 30+ scan/lookup call sites
CREATE INDEX CONCURRENTLY IF NOT EXISTS "inventory_serials_serialNumber_idx"
  ON inventory_serials ("serialNumber");

-- OPTIONAL: for case-insensitive `contains` serial searches, a trigram GIN index
-- helps far more than the btree above. Requires the pg_trgm extension.
-- CREATE EXTENSION IF NOT EXISTS pg_trgm;
-- CREATE INDEX CONCURRENTLY IF NOT EXISTS "inventory_serials_serialNumber_trgm_idx"
--   ON inventory_serials USING gin ("serialNumber" gin_trgm_ops);
