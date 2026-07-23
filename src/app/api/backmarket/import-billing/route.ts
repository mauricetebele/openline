/**
 * POST /api/backmarket/import-billing
 *
 * Imports a BackMarket billing/invoice statement CSV. Stores every order-related
 * line in `bm_billing_entries` (idempotent), then recomputes the affected orders
 * from ALL stored entries (so refunds/adjustments arriving in a later statement
 * accumulate correctly):
 *   - item sale price   = Σ `sales` for that seller SKU  (the TRUE price)
 *   - order marketplace fees = −Σ(every non-`sales` entry)  (commission, payment,
 *     Customer Care, credits, refunds, net-zero dp adjustments)
 *   - order total       = Σ item prices
 *
 * Body: { csv: string, statementRef?: string }
 */
import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { getAuthUser } from '@/lib/get-auth-user'
import { requireAdmin } from '@/lib/auth-helpers'
import { prisma } from '@/lib/prisma'
import { parseBmBilling, FEE_KEYS, type BmBillingRow, type UnknownKeyFlag } from '@/lib/backmarket/parse-billing'
import { randomUUID } from 'crypto'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

function dedupeKey(r: { invoiceKey: string; valueDate: string | null; orderId: string; sku: string | null; amount: number }) {
  return `${r.invoiceKey}|${r.valueDate ?? ''}|${r.orderId}|${r.sku ?? ''}|${r.amount}`
}
const round2 = (n: number) => Math.round(n * 100) / 100

export async function POST(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const adminErr = requireAdmin(user)
  if (adminErr) return adminErr

  const body = await req.json().catch(() => null)

  // Accept one statement ({ csv, statementRef }) or many ({ statements: [{name, csv}] }).
  const rawStatements: { name: string | null; csv: string }[] = Array.isArray(body?.statements)
    ? body.statements.map((s: unknown) => ({
        name: typeof (s as { name?: unknown })?.name === 'string' ? ((s as { name: string }).name.trim() || null) : null,
        csv: typeof (s as { csv?: unknown })?.csv === 'string' ? (s as { csv: string }).csv : '',
      }))
    : typeof body?.csv === 'string'
      ? [{ name: typeof body?.statementRef === 'string' ? body.statementRef.trim() || null : null, csv: body.csv }]
      : []

  const statements = rawStatements.filter(s => s.csv.trim())
  if (statements.length === 0) return NextResponse.json({ error: 'No statement CSVs provided' }, { status: 400 })
  if (statements.length > 50) return NextResponse.json({ error: 'Too many files — limit is 50 statements at once.' }, { status: 400 })

  // Parse each statement; combine rows, merge the unknown-key flags.
  const allRows: (BmBillingRow & { statementRef: string | null })[] = []
  const unknownMap = new Map<string, UnknownKeyFlag>()
  let rowsIgnored = 0
  for (const st of statements) {
    let parsed
    try {
      parsed = parseBmBilling(st.csv)
    } catch (e) {
      return NextResponse.json({ error: `${st.name ?? 'A file'}: ${e instanceof Error ? e.message : 'Failed to parse CSV'}` }, { status: 400 })
    }
    rowsIgnored += parsed.ignored
    for (const r of parsed.rows) allRows.push({ ...r, statementRef: st.name })
    for (const u of parsed.unknownKeys) {
      const f = unknownMap.get(u.invoiceKey) ?? { invoiceKey: u.invoiceKey, count: 0, totalAmount: 0, sampleOrderIds: [] }
      f.count += u.count
      f.totalAmount = round2(f.totalAmount + u.totalAmount)
      for (const oid of u.sampleOrderIds) if (f.sampleOrderIds.length < 5 && !f.sampleOrderIds.includes(oid)) f.sampleOrderIds.push(oid)
      unknownMap.set(u.invoiceKey, f)
    }
  }
  if (allRows.length === 0) {
    return NextResponse.json({ error: 'No order-related billing rows found in the file(s).' }, { status: 400 })
  }

  // Resolve each identifier: an Order # (matches a BM order) is kept as-is; an
  // OrderLine # (matches a BM order_item) is resolved to its parent order and the
  // orderline recorded separately. Anything else is left as-is (order not in our
  // system). Order-match takes priority so order-level rows are never re-resolved.
  const rawIds = Array.from(new Set(allRows.map(r => r.orderId).filter(Boolean)))
  const [orderIdRows, orderlineRows] = await Promise.all([
    prisma.order.findMany({ where: { amazonOrderId: { in: rawIds }, orderSource: 'backmarket' }, select: { amazonOrderId: true } }),
    prisma.orderItem.findMany({ where: { orderItemId: { in: rawIds }, order: { orderSource: 'backmarket' } }, select: { orderItemId: true, order: { select: { amazonOrderId: true } } } }),
  ])
  const orderSet = new Set(orderIdRows.map(o => o.amazonOrderId))
  const orderlineMap = new Map(orderlineRows.map(oi => [oi.orderItemId, oi.order.amazonOrderId]))
  const resolve = (raw: string): { orderId: string; orderlineId: string | null } => {
    if (!raw || orderSet.has(raw)) return { orderId: raw, orderlineId: null }
    const parent = orderlineMap.get(raw)
    return parent ? { orderId: parent, orderlineId: raw } : { orderId: raw, orderlineId: null }
  }

  // 1. Upsert every parsed line (idempotent on dedupe_key, keyed by the raw id).
  const values = allRows.map(r => {
    const res = resolve(r.orderId)
    return Prisma.sql`(${randomUUID()}, ${r.invoiceKey}, ${r.valueDate ? new Date(r.valueDate) : null}, ${res.orderId}, ${res.orderlineId}, ${r.sku}, ${r.designation}, ${r.amount}, ${r.currency}, ${r.statementRef}, ${dedupeKey(r)})`
  })
  const CHUNK = 500
  for (let i = 0; i < values.length; i += CHUNK) {
    const slice = values.slice(i, i + CHUNK)
    await prisma.$executeRaw`
      INSERT INTO bm_billing_entries
        (id, invoice_key, value_date, order_id, orderline_id, sku, designation, amount, currency, statement_ref, dedupe_key)
      VALUES ${Prisma.join(slice)}
      ON CONFLICT (dedupe_key) DO NOTHING`
  }

  // 2. Recompute affected orders from ALL stored entries (using resolved order #s).
  const orderIds = Array.from(new Set(allRows.map(r => resolve(r.orderId).orderId).filter(Boolean)))

  const salesRows = await prisma.$queryRaw<{ order_id: string; sku: string | null; sales: number }[]>`
    SELECT order_id, sku, SUM(amount)::float8 AS sales
    FROM bm_billing_entries
    WHERE invoice_key = 'sales' AND order_id = ANY(${orderIds}::text[])
    GROUP BY order_id, sku`
  // Only KNOWN fee keys count toward the profitability fee figure (whitelist),
  // so an unrecognised transaction type can never silently affect profit.
  // `refunds` are deliberately left out for now (returns modelled separately);
  // every entry is still stored in bm_billing_entries / the Financial Explorer.
  const feeKeys = [...FEE_KEYS]
  const feeRows = await prisma.$queryRaw<{ order_id: string; net_fees: number }[]>`
    SELECT order_id, SUM(amount)::float8 AS net_fees
    FROM bm_billing_entries
    WHERE invoice_key = ANY(${feeKeys}::text[]) AND order_id = ANY(${orderIds}::text[])
    GROUP BY order_id`

  const salesByOrderSku = new Map<string, number>() // `${orderId}|${sku}` -> sales
  const salesByOrder = new Map<string, number>()
  for (const s of salesRows) {
    salesByOrderSku.set(`${s.order_id}|${s.sku ?? ''}`, s.sales)
    salesByOrder.set(s.order_id, (salesByOrder.get(s.order_id) ?? 0) + s.sales)
  }
  const netFeesByOrder = new Map(feeRows.map(f => [f.order_id, f.net_fees]))

  const orders = await prisma.order.findMany({
    where: { amazonOrderId: { in: orderIds }, orderSource: 'backmarket' },
    select: { id: true, amazonOrderId: true, items: { select: { id: true, sellerSku: true, itemPrice: true } } },
  })

  let ordersUpdated = 0
  let itemsRepriced = 0
  const unmatchedOrders: string[] = []
  const corrections: { orderId: string; oldTotal: number; newTotal: number }[] = []

  for (const order of orders) {
    const oid = order.amazonOrderId
    const orderSalesTotal = salesByOrder.get(oid)
    const netFees = netFeesByOrder.get(oid)

    await prisma.$transaction(async tx => {
      let newTotal = 0
      const oldTotal = order.items.reduce((s, i) => s + Number(i.itemPrice ?? 0), 0)
      const singleSalePrice = order.items.length === 1 ? salesByOrder.get(oid) : undefined

      for (const item of order.items) {
        // Match the sales line by seller SKU; fall back to the order's single sales total.
        let sale = salesByOrderSku.get(`${oid}|${item.sellerSku ?? ''}`)
        if (sale === undefined && order.items.length === 1 && singleSalePrice !== undefined) sale = singleSalePrice
        if (sale !== undefined && sale > 0 && round2(sale) !== round2(Number(item.itemPrice ?? 0))) {
          await tx.orderItem.update({ where: { id: item.id }, data: { itemPrice: round2(sale) } })
          itemsRepriced++
        }
        newTotal += sale !== undefined && sale > 0 ? round2(sale) : Number(item.itemPrice ?? 0)
      }

      const data: { orderTotal?: number; marketplaceCommission?: number; commissionSyncedAt?: Date } = {}
      if (orderSalesTotal !== undefined && orderSalesTotal > 0) data.orderTotal = round2(newTotal)
      if (netFees !== undefined) { data.marketplaceCommission = round2(-netFees); data.commissionSyncedAt = new Date() }
      if (Object.keys(data).length > 0) await tx.order.update({ where: { id: order.id }, data })

      if (round2(oldTotal) !== round2(newTotal) && orderSalesTotal) {
        corrections.push({ orderId: oid, oldTotal: round2(oldTotal), newTotal: round2(newTotal) })
      }
    })
    ordersUpdated++
  }

  const foundIds = new Set(orders.map(o => o.amazonOrderId))
  for (const oid of orderIds) if (!foundIds.has(oid)) unmatchedOrders.push(oid)

  return NextResponse.json({
    statements: statements.length,
    rowsParsed: allRows.length,
    rowsIgnored,
    ordersInStatement: orderIds.length,
    ordersMatched: orders.length,
    ordersUpdated,
    itemsRepriced,
    unmatchedOrders: unmatchedOrders.slice(0, 100),
    unmatchedCount: unmatchedOrders.length,
    corrections: corrections.slice(0, 200),
    unknownKeys: Array.from(unknownMap.values()),
  })
}
