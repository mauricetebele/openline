/**
 * Parser for BackMarket billing/invoice statement CSVs.
 *
 * Columns: invoice_key, value_date, sku, order_id, designation, amount, currency
 *
 * Notes on the data (per the seller's spec):
 *  - `sales` is the TRUE item selling price (revenue). BackMarket's orders API
 *    inflates the price it returns by the `sales_dp_adjustment` (a positive
 *    adjustment cancelled by an offsetting `dp_adjustment_fee`), so the sale
 *    price must come from here, not the orders feed.
 *  - Every other order-related key is a fee/credit/adjustment (signed amounts):
 *      costs   (−): sales_fees, payment_fees, ccbm_fees, credit_requests, refunds
 *      credits (+): deals_commission_discount, avoir_sales_fees
 *      net-zero:    sales_dp_adjustment, dp_adjustment_fee, dp_adjustment_fee_refund
 *  - `deals_commission_discount` and `avoir_sales_fees` carry the order id at the
 *    END of the designation column (`…order_id<digits>`), NOT in order_id.
 *  - deferred_payout_* rows are not order-related and are ignored.
 */

export type BmBillingRow = {
  invoiceKey: string
  valueDate: string | null
  orderId: string
  sku: string | null
  designation: string | null
  amount: number
  currency: string | null
}

export type UnknownKeyFlag = {
  invoiceKey: string
  count: number
  totalAmount: number
  sampleOrderIds: string[]
}

export type ParsedBmBilling = {
  rows: BmBillingRow[]
  totalRows: number
  ignored: number
  /** invoice_keys not in KNOWN_INVOICE_KEYS — surfaced so the user can review. */
  unknownKeys: UnknownKeyFlag[]
}

/** invoice_keys whose order id lives at the end of the designation column. */
const ORDER_ID_IN_DESIGNATION = new Set(['deals_commission_discount', 'avoir_sales_fees'])
/** invoice_keys that are not order-related and must be skipped entirely. */
const IGNORED_KEYS = new Set(['deferred_payout_retained', 'deferred_payout_released'])

/**
 * Known account-level keys (not tied to a specific order). These are STILL
 * stored (searchable in the Financial Explorer) even when they carry no order
 * id, but they never count toward per-order profitability.
 */
const ACCOUNT_LEVEL_KEYS = new Set(['monthly_fees'])

/** invoice_keys that count as marketplace fees in profitability (whitelist). */
export const FEE_KEYS = [
  'sales_fees',
  'payment_fees', 'affirm_fees', 'paypal_fees', 'klarna_fees', // payment-provider fees
  'ccbm_fees', 'credit_requests',
  'deals_commission_discount', 'avoir_sales_fees',
  'sales_dp_adjustment', 'dp_adjustment_fee', 'dp_adjustment_fee_refund',
  'manual_reimbursement', // manually-entered reimbursement (credit)
] as const

/** Every recognised invoice_key. Anything else is flagged as unknown on import. */
export const KNOWN_INVOICE_KEYS = new Set<string>([
  'sales', 'refunds', 'monthly_fees', 'deferred_payout_retained', 'deferred_payout_released', ...FEE_KEYS,
])

/** Split one CSV line, honouring double-quoted fields that may contain commas. */
function splitCsvLine(line: string): string[] {
  const out: string[] = []
  let cur = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++ }
        else inQuotes = false
      } else cur += c
    } else if (c === '"') {
      inQuotes = true
    } else if (c === ',') {
      out.push(cur); cur = ''
    } else cur += c
  }
  out.push(cur)
  return out
}

export function parseBmBilling(csv: string): ParsedBmBilling {
  const lines = csv.split(/\r?\n/).filter(l => l.trim().length > 0)
  if (lines.length === 0) return { rows: [], totalRows: 0, ignored: 0, unknownKeys: [] }

  const header = splitCsvLine(lines[0]).map(h => h.trim().toLowerCase())
  const col = {
    key: header.indexOf('invoice_key'),
    valueDate: header.indexOf('value_date'),
    sku: header.indexOf('sku'),
    orderId: header.indexOf('order_id'),
    designation: header.indexOf('designation'),
    amount: header.indexOf('amount'),
    currency: header.indexOf('currency'),
  }
  if (col.key < 0 || col.orderId < 0 || col.amount < 0 || col.designation < 0) {
    throw new Error('Unexpected CSV format — expected invoice_key, order_id, designation and amount columns')
  }

  const rows: BmBillingRow[] = []
  const unknown = new Map<string, UnknownKeyFlag>()
  let ignored = 0
  for (let i = 1; i < lines.length; i++) {
    const c = splitCsvLine(lines[i])
    const invoiceKey = (c[col.key] ?? '').trim()
    if (!invoiceKey) { ignored++; continue }
    if (IGNORED_KEYS.has(invoiceKey)) { ignored++; continue }

    const designation = (c[col.designation] ?? '').trim() || null
    let orderId = (c[col.orderId] ?? '').trim()
    if (ORDER_ID_IN_DESIGNATION.has(invoiceKey)) {
      const m = designation?.match(/order_id(\d+)/i)
      orderId = m ? m[1] : ''
    }
    const amount = parseFloat((c[col.amount] ?? '').trim())

    // Flag any unrecognised transaction type so nothing is silently miscategorised.
    if (!KNOWN_INVOICE_KEYS.has(invoiceKey)) {
      const f = unknown.get(invoiceKey) ?? { invoiceKey, count: 0, totalAmount: 0, sampleOrderIds: [] }
      f.count++
      if (Number.isFinite(amount)) f.totalAmount = Math.round((f.totalAmount + amount) * 100) / 100
      if (orderId && f.sampleOrderIds.length < 5 && !f.sampleOrderIds.includes(orderId)) f.sampleOrderIds.push(orderId)
      unknown.set(invoiceKey, f)
    }

    if (!Number.isFinite(amount)) { ignored++; continue }
    // Account-level entries (e.g. monthly membership fee) may have no order id —
    // still stored (Explorer), just never applied to an order. Order-level rows
    // without an order id are data anomalies and skipped.
    if (!orderId && !ACCOUNT_LEVEL_KEYS.has(invoiceKey)) { ignored++; continue }

    rows.push({
      invoiceKey,
      valueDate: (c[col.valueDate] ?? '').trim() || null,
      orderId,
      sku: (c[col.sku] ?? '').trim() || null,
      designation,
      amount,
      currency: (c[col.currency] ?? '').trim() || null,
    })
  }

  return { rows, totalRows: lines.length - 1, ignored, unknownKeys: Array.from(unknown.values()) }
}

/** Keys that represent revenue (the item sale price). */
export const SALES_KEY = 'sales'

/**
 * invoice_keys excluded from the "BackMarket fees" figure shown in profitability.
 * `sales` is revenue (not a fee); `refunds` are deferred to a later returns model.
 * Entries are still stored/visible in the Financial Explorer regardless.
 */
export const FEE_EXCLUDED_KEYS = ['sales', 'refunds'] as const

/**
 * Aggregate parsed rows per order:
 *  - salesBySku: Σ `sales` amount per sku (→ item sale price)
 *  - salesTotal: Σ all `sales`
 *  - netFees:    Σ of every non-`sales` amount (signed; usually negative)
 *  - feeBySku is not needed — fees are order-level for our purposes.
 */
export type OrderBillingAgg = {
  orderId: string
  salesTotal: number
  salesBySku: Map<string, number>
  netFees: number // signed sum of all non-sales entries
}

export function aggregateByOrder(rows: BmBillingRow[]): Map<string, OrderBillingAgg> {
  const map = new Map<string, OrderBillingAgg>()
  for (const r of rows) {
    let agg = map.get(r.orderId)
    if (!agg) {
      agg = { orderId: r.orderId, salesTotal: 0, salesBySku: new Map(), netFees: 0 }
      map.set(r.orderId, agg)
    }
    if (r.invoiceKey === SALES_KEY) {
      agg.salesTotal += r.amount
      const key = r.sku ?? ''
      agg.salesBySku.set(key, (agg.salesBySku.get(key) ?? 0) + r.amount)
    } else {
      agg.netFees += r.amount
    }
  }
  return map
}
