-- Track how a SICKW check was initiated: "manual" (user-clicked) vs
-- "auto_return" (automatic FMI check on an initiated return). Null for
-- historical checks that predate this column. Additive/non-destructive.

ALTER TABLE "sickw_checks" ADD COLUMN IF NOT EXISTS "source" TEXT;
