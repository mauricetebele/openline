-- BackMarket billing/invoice statement entries.
-- Each row is one line from a BackMarket billing statement CSV
-- (invoice_key, value_date, sku, order_id, designation, amount, currency).
-- Stored per-line so re-importing a statement is idempotent (dedupe_key) and so
-- refunds/adjustments that land in a later statement accumulate onto the order.
CREATE TABLE IF NOT EXISTS "bm_billing_entries" (
  "id"            TEXT PRIMARY KEY,
  "invoice_key"   TEXT NOT NULL,
  "value_date"    TIMESTAMPTZ,
  "order_id"      TEXT NOT NULL,
  "sku"           TEXT,
  "designation"   TEXT,
  "amount"        NUMERIC(12,2) NOT NULL,
  "currency"      TEXT,
  "statement_ref" TEXT,
  "dedupe_key"    TEXT NOT NULL,
  -- Set when the statement referenced an order LINE (order_item) rather than the
  -- parent order; order_id then holds the resolved parent order.
  "orderline_id"  TEXT,
  -- Manual annotation (e.g. justifying a refund with no return) + a
  -- problematic/non-problematic flag.
  "note"          TEXT,
  "problematic"   BOOLEAN,
  "created_at"    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "bm_billing_entries_dedupe_key_idx" ON "bm_billing_entries" ("dedupe_key");
CREATE INDEX IF NOT EXISTS "bm_billing_entries_order_id_idx" ON "bm_billing_entries" ("order_id");
CREATE INDEX IF NOT EXISTS "bm_billing_entries_invoice_key_idx" ON "bm_billing_entries" ("invoice_key");
CREATE INDEX IF NOT EXISTS "bm_billing_entries_orderline_id_idx" ON "bm_billing_entries" ("orderline_id");
