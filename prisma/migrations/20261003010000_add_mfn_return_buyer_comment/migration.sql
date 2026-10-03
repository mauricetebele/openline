-- Free-text buyer comment left with an Amazon return (adds color to the reason code).
ALTER TABLE "mfn_returns" ADD COLUMN IF NOT EXISTS "buyerComment" TEXT;
