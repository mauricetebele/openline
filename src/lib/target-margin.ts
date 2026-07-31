/**
 * Target-margin pricing math (template-driven), shared by the Marketplace SKUs UI.
 *
 * A SKU's Calculation Template supplies the commission % and a per-package-preset
 * shipping cost. Net margin = profit ÷ price, where
 *   profit = price − commission(%·price) − avgUnitCost − avgCostCode − shipping
 * Solving for the price that hits a target margin:
 *   price = (avgUnitCost + avgCostCode + shipping) / (1 − commission% − targetMargin%)
 */

export interface TemplateFees {
  commissionPct: number // percent of selling price (e.g. 8)
  shipping: number // flat shipping dollars for this SKU's package preset
}

export interface CalcTemplate {
  id: string
  name: string
  commissionPct: string | number
  packageCosts: { packagePresetId: string; cost: string | number }[]
}

/**
 * Resolve the fee structure for a row from its assigned template + the product's
 * package preset. Returns null when there's no template (⇒ not eligible for target
 * margin). Shipping is the template's cost for the preset, or 0 if the product has
 * no preset / the template has no cost for it.
 */
export function resolveFees(
  template: CalcTemplate | undefined | null,
  packagePresetId: string | null | undefined,
): TemplateFees | null {
  if (!template) return null
  const commissionPct = Number(template.commissionPct)
  if (!Number.isFinite(commissionPct)) return null
  let shipping = 0
  if (packagePresetId) {
    const pc = template.packageCosts.find((c) => c.packagePresetId === packagePresetId)
    if (pc) shipping = Number(pc.cost)
  }
  return { commissionPct, shipping }
}

/** Price that realizes `marginPct` (a percent, e.g. 25). Null if unreachable. */
export function computeTargetPrice(
  avgUnitCost: number,
  avgCostCode: number,
  fees: TemplateFees,
  marginPct: number,
): number | null {
  const cost = avgUnitCost + avgCostCode + fees.shipping
  const denom = 1 - fees.commissionPct / 100 - marginPct / 100
  if (denom <= 0) return null
  const price = cost / denom
  return Number.isFinite(price) && price > 0 ? price : null
}

export interface MarginBreakdown {
  price: number
  avgUnitCost: number
  avgCostCode: number
  commission: number
  commissionPct: number
  shipping: number
  netProfit: number
  marginPct: number
}

/** Full breakdown at a given selling price. */
export function breakdownAtPrice(
  price: number,
  avgUnitCost: number,
  avgCostCode: number,
  fees: TemplateFees,
): MarginBreakdown {
  const commission = (fees.commissionPct / 100) * price
  const netProfit = price - commission - avgUnitCost - avgCostCode - fees.shipping
  const marginPct = price > 0 ? (netProfit / price) * 100 : 0
  return {
    price, avgUnitCost, avgCostCode, commission,
    commissionPct: fees.commissionPct, shipping: fees.shipping, netProfit, marginPct,
  }
}

/** Net margin % realized at a given selling price. Null if price invalid. */
export function marginAtPrice(
  price: number,
  avgUnitCost: number,
  avgCostCode: number,
  fees: TemplateFees,
): number | null {
  if (!(price > 0)) return null
  return breakdownAtPrice(price, avgUnitCost, avgCostCode, fees).marginPct
}
