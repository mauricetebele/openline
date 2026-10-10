-- Repricing AI feedback loop: Claude's reply to each decision comment, learning
-- runs (learnings + proposed parameter changes), and strategy-parameter overrides.
ALTER TABLE "repricing_decisions" ADD COLUMN IF NOT EXISTS "aiReply" TEXT;

CREATE TABLE IF NOT EXISTS "repricing_learnings" (
  "id" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdBy" TEXT,
  "model" TEXT NOT NULL,
  "decisionsAnalyzed" INTEGER NOT NULL,
  "summary" TEXT NOT NULL,
  "learnings" JSONB NOT NULL,
  "proposals" JSONB NOT NULL,
  CONSTRAINT "repricing_learnings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "repricing_strategy_params" (
  "id" TEXT NOT NULL,
  "strategy" TEXT NOT NULL,
  "param" TEXT NOT NULL,
  "value" DECIMAL(12,4) NOT NULL,
  "source" TEXT,
  "updatedBy" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "repricing_strategy_params_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "repricing_strategy_params_strategy_param_key"
  ON "repricing_strategy_params" ("strategy", "param");
