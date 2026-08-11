-- Index tracking numbers so the shipping-bill audit can match carrier invoice
-- rows to purchased labels by tracking number efficiently. Additive.

CREATE INDEX IF NOT EXISTS "order_labels_trackingNumber_idx" ON "order_labels" ("trackingNumber");
CREATE INDEX IF NOT EXISTS "return_labels_trackingNumber_idx" ON "return_labels" ("trackingNumber");
