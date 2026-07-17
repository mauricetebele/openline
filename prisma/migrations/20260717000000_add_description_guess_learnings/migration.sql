-- Learning store for the Description Guessing feature.
-- Holds user-corrected SKU→description pairs. Kept SEPARATE from the products
-- table: this feature never writes to products. These corrections feed the
-- guesser's corpus so future guesses improve, and are returned verbatim when an
-- already-corrected SKU is guessed again.
CREATE TABLE IF NOT EXISTS "description_guess_learnings" (
  "id"          TEXT PRIMARY KEY,
  "sku"         TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "created_at"  TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at"  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "description_guess_learnings_sku_key"
  ON "description_guess_learnings" ("sku");
