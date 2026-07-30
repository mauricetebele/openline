/**
 * Target-margin pricing math shared by the API and the Marketplace SKUs UI.
 *
 * Price that realizes a target net margin (profit ÷ price):
 *   margin = (P − cost − flat − pct·P − shipping) / P
 *   ⇒ P = (cost + flat + shipping) / (1 − pct − margin)
 * where `cost` is the average landed cost (unit cost + cost-code amount) of the
 * in-stock finished-goods units.
 */

export type MarginCategory = 'mac' | 'phone' | 'other'

/** Category from the parent product SKU prefix (no Product.category field exists). */
export function detectCategory(productSku: string | null | undefined): MarginCategory {
  const s = (productSku ?? '').toUpperCase()
  if (/^(IMAC|MBPRO|MBAIR|MACBOOK)/.test(s)) return 'mac'
  if (/^(IPHONE|SAM)/.test(s)) return 'phone' // iPhone + Samsung phones
  return 'other'
}

export interface FeeStructure {
  pct: number // commission as a fraction of price (e.g. 0.08)
  flat: number // flat commission dollars
  shipping: number // flat shipping dollars
}

/**
 * Marketplace + category fee structure. Returns null when no commission rule applies
 * (e.g. Back Market SKUs that are neither Mac nor phone) — those get no target price.
 */
export function feesFor(marketplace: string, productSku: string | null | undefined): FeeStructure | null {
  if (marketplace === 'amazon') return { pct: 0.08, flat: 0, shipping: 12 }
  if (marketplace === 'backmarket') {
    const cat = detectCategory(productSku)
    if (cat === 'mac') return { pct: 0, flat: 14, shipping: 18 }
    if (cat === 'phone') return { pct: 0.12, flat: 0, shipping: 18 }
    return null // other Back Market categories — no rule
  }
  return null
}

/** Price that hits `marginPct` (a percent, e.g. 25). Null if unreachable (margin too high). */
export function computeTargetPrice(cost: number, fees: FeeStructure, marginPct: number): number | null {
  const denom = 1 - fees.pct - marginPct / 100
  if (denom <= 0) return null
  const price = (cost + fees.flat + fees.shipping) / denom
  return Number.isFinite(price) && price > 0 ? price : null
}

export interface MarginBreakdown {
  cost: number
  fees: FeeStructure
  marginPct: number
  targetPrice: number
  commission: number // resolved commission dollars at the target price
  netProfit: number
}

/** Full breakdown for the confirm dialog / tooltip. Null if no fee rule or unreachable. */
export function marginBreakdown(
  cost: number,
  marketplace: string,
  productSku: string | null | undefined,
  marginPct: number,
): MarginBreakdown | null {
  const fees = feesFor(marketplace, productSku)
  if (!fees) return null
  const targetPrice = computeTargetPrice(cost, fees, marginPct)
  if (targetPrice == null) return null
  const commission = fees.flat + fees.pct * targetPrice
  const netProfit = targetPrice - cost - commission - fees.shipping
  return { cost, fees, marginPct, targetPrice, commission, netProfit }
}
