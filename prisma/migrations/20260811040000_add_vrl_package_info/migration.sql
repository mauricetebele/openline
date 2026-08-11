-- Per-piece package weight/dims snapshot on vendor return labels. Additive.
ALTER TABLE "vendor_return_labels" ADD COLUMN IF NOT EXISTS "packageInfo" JSONB;
