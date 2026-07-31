-- Calculation Templates for target-margin pricing: a named template with a commission
-- % and an estimated shipping cost per package preset. Assigned to marketplace SKUs.
-- Additive/non-destructive.

CREATE TABLE IF NOT EXISTS "calculation_templates" (
  "id"            TEXT PRIMARY KEY,
  "name"          TEXT NOT NULL,
  "commissionPct" DECIMAL(5,2) NOT NULL,
  "isActive"      BOOLEAN NOT NULL DEFAULT true,
  "createdAt"     TIMESTAMP NOT NULL DEFAULT now(),
  "updatedAt"     TIMESTAMP NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "calculation_templates_name_key" ON "calculation_templates" ("name");

CREATE TABLE IF NOT EXISTS "calculation_template_package_costs" (
  "id"              TEXT PRIMARY KEY,
  "templateId"      TEXT NOT NULL REFERENCES "calculation_templates"("id") ON DELETE CASCADE,
  "packagePresetId" TEXT NOT NULL REFERENCES "package_presets"("id") ON DELETE CASCADE,
  "cost"            DECIMAL(12,2) NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "calculation_template_package_costs_templateId_packagePresetId_key"
  ON "calculation_template_package_costs" ("templateId", "packagePresetId");
CREATE INDEX IF NOT EXISTS "calculation_template_package_costs_templateId_idx"
  ON "calculation_template_package_costs" ("templateId");

ALTER TABLE "product_grade_marketplace_skus"
  ADD COLUMN IF NOT EXISTS "calculationTemplateId" TEXT
  REFERENCES "calculation_templates"("id") ON DELETE SET NULL;
