-- Weight & dims request workflow on orders
ALTER TABLE "orders"
  ADD COLUMN IF NOT EXISTS "weightDimsRequested" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "weightDimsText" TEXT,
  ADD COLUMN IF NOT EXISTS "weightDimsRequestedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "weightDimsEnteredAt" TIMESTAMP(3);
