/**
 * GET /api/backmarket/billing-entries
 *
 * BackMarket Financial Explorer — lists stored billing/accounting entries,
 * searchable by order #, SKU, or invoice_key. Read-only.
 *
 * Query: search (order #, sku, or key), page, pageSize
 */
import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { getAuthUser } from '@/lib/get-auth-user'
import { requireAdmin } from '@/lib/auth-helpers'
import { prisma } from '@/lib/prisma'
import { FEE_KEYS } from '@/lib/backmarket/parse-billing'
import { randomUUID } from 'crypto'

export const dynamic = 'force-dynamic'

const round2 = (n: number) => Math.round(n * 100) / 100

type Entry = {
  id: string
  invoice_key: string
  value_date: string | null
  order_id: string
  orderline_id: string | null
  sku: string | null
  designation: string | null
  amount: number
  currency: string | null
  statement_ref: string | null
}

export async function GET(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const sp = req.nextUrl.searchParams
  const search = sp.get('search')?.trim() ?? ''
  const type = sp.get('type')?.trim() ?? ''
  const page = Math.max(1, parseInt(sp.get('page') ?? '1', 10) || 1)
  const pageSize = Math.min(200, Math.max(1, parseInt(sp.get('pageSize') ?? '100', 10) || 100))
  const offset = (page - 1) * pageSize

  // Whitelisted sort columns (raw column name is safe — never user-supplied text).
  const SORT_COLS: Record<string, string> = {
    order_id: 'order_id', orderline_id: 'orderline_id', invoice_key: 'invoice_key',
    sku: 'sku', value_date: 'value_date', amount: 'amount',
  }
  const sortCol = SORT_COLS[sp.get('sort') ?? ''] ?? 'value_date'
  const dir = sp.get('dir') === 'asc' ? Prisma.raw('ASC') : Prisma.raw('DESC')
  const orderBy = Prisma.sql`ORDER BY ${Prisma.raw(sortCol)} ${dir} NULLS LAST, order_id`

  const conds: Prisma.Sql[] = []
  if (search) {
    // If the search is numeric, also match by amount magnitude (so "26" finds
    // both +26 and −26). Strip $ and commas first.
    const numeric = parseFloat(search.replace(/[$,\s]/g, ''))
    const amountClause = Number.isFinite(numeric)
      ? Prisma.sql` OR ABS(amount) = ${Math.abs(numeric)}`
      : Prisma.empty
    conds.push(Prisma.sql`(order_id = ${search} OR orderline_id = ${search} OR order_id ILIKE ${'%' + search + '%'} OR orderline_id ILIKE ${'%' + search + '%'} OR sku ILIKE ${'%' + search + '%'} OR invoice_key ILIKE ${'%' + search + '%'}${amountClause})`)
  }
  if (type) conds.push(Prisma.sql`invoice_key = ${type}`)
  const where = conds.length > 0 ? Prisma.sql`WHERE ${Prisma.join(conds, ' AND ')}` : Prisma.empty

  const [rows, countRows, sumRows, typeRows] = await Promise.all([
    prisma.$queryRaw<Entry[]>`
      SELECT id, invoice_key, value_date, order_id, orderline_id, sku, designation, amount::float8 AS amount, currency, statement_ref
      FROM bm_billing_entries
      ${where}
      ${orderBy}
      LIMIT ${pageSize} OFFSET ${offset}`,
    prisma.$queryRaw<{ total: bigint }[]>`SELECT COUNT(*)::bigint AS total FROM bm_billing_entries ${where}`,
    prisma.$queryRaw<{ amount_sum: number | null }[]>`SELECT SUM(amount)::float8 AS amount_sum FROM bm_billing_entries ${where}`,
    prisma.$queryRaw<{ invoice_key: string }[]>`SELECT DISTINCT invoice_key FROM bm_billing_entries ORDER BY invoice_key`,
  ])

  // Flag whether each entry's order exists in our system (BackMarket order).
  const pageOrderIds = Array.from(new Set(rows.map(r => r.order_id).filter(Boolean)))
  const existing = pageOrderIds.length > 0
    ? await prisma.order.findMany({ where: { amazonOrderId: { in: pageOrderIds }, orderSource: 'backmarket' }, select: { amazonOrderId: true } })
    : []
  const existSet = new Set(existing.map(o => o.amazonOrderId))

  // For refund rows whose order exists, look up the associated return (RMA) and
  // its receive progress (units received / units returned).
  const refundOrderIds = Array.from(new Set(
    rows.filter(r => r.invoice_key === 'refunds' && r.order_id && existSet.has(r.order_id)).map(r => r.order_id),
  ))
  const rmaMap = new Map<string, { numbers: string[]; received: number; total: number }>()
  if (refundOrderIds.length > 0) {
    const rmaRows = await prisma.$queryRaw<{ order_id: string; rma_numbers: string[]; total_units: number; received: number }[]>`
      WITH rma_orders AS (
        SELECT o."amazonOrderId" AS order_id, o.id AS oid, r.id AS rma_id, r."rmaNumber"
        FROM marketplace_rmas r JOIN orders o ON o.id = r."orderId"
        WHERE o."amazonOrderId" = ANY(${refundOrderIds}::text[]) AND o."orderSource" = 'backmarket'
      ),
      qty AS ( -- denominator = total units SOLD on the order
        SELECT ro.order_id, SUM(oi."quantityOrdered")::int AS total_units
        FROM (SELECT DISTINCT order_id, oid FROM rma_orders) ro
        JOIN order_items oi ON oi."orderId" = ro.oid
        GROUP BY ro.order_id
      ),
      recv AS ( -- numerator = returned units received into the system
        SELECT ro.order_id, COUNT(s.id) FILTER (WHERE s."receivedAt" IS NOT NULL)::int AS received
        FROM rma_orders ro
        JOIN marketplace_rma_items mi ON mi."rmaId" = ro.rma_id
        JOIN marketplace_rma_serials s ON s."rmaItemId" = mi.id
        GROUP BY ro.order_id
      ),
      nums AS (SELECT order_id, array_agg(DISTINCT "rmaNumber") AS rma_numbers FROM rma_orders GROUP BY order_id)
      SELECT n.order_id, n.rma_numbers, COALESCE(q.total_units, 0) AS total_units, COALESCE(rc.received, 0) AS received
      FROM nums n LEFT JOIN qty q ON q.order_id = n.order_id LEFT JOIN recv rc ON rc.order_id = n.order_id`
    for (const rr of rmaRows) rmaMap.set(rr.order_id, { numbers: rr.rma_numbers, received: Number(rr.received), total: Number(rr.total_units) })
  }

  const data = rows.map(r => {
    const base = { ...r, order_exists: r.order_id ? existSet.has(r.order_id) : null }
    if (r.invoice_key === 'refunds' && r.order_id && existSet.has(r.order_id)) {
      return { ...base, rmaInfo: rmaMap.get(r.order_id) ?? null }
    }
    return base
  })

  return NextResponse.json({
    data,
    total: Number(countRows[0]?.total ?? 0),
    amountSum: sumRows[0]?.amount_sum ?? 0,
    types: typeRows.map(t => t.invoice_key),
    page,
    pageSize,
  })
}

/**
 * POST /api/backmarket/billing-entries
 * Manually record a Seller Compensation Reimbursement for an order.
 * Body: { orderId: string, amount: number, date?: string (YYYY-MM-DD) }
 */
export async function POST(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const adminErr = requireAdmin(user)
  if (adminErr) return adminErr

  const body = await req.json().catch(() => null)
  const orderId = typeof body?.orderId === 'string' ? body.orderId.trim() : ''
  const amount = typeof body?.amount === 'number' ? body.amount : parseFloat(String(body?.amount ?? ''))
  const dateStr = typeof body?.date === 'string' ? body.date.trim() : ''

  if (!orderId) return NextResponse.json({ error: 'Order # is required' }, { status: 400 })
  if (!Number.isFinite(amount) || amount === 0) return NextResponse.json({ error: 'A non-zero amount is required' }, { status: 400 })
  const valueDate = dateStr ? new Date(`${dateStr}T00:00:00Z`) : new Date()
  if (isNaN(valueDate.getTime())) return NextResponse.json({ error: 'Invalid date' }, { status: 400 })

  const amt = round2(amount)
  const id = randomUUID()
  await prisma.$executeRaw`
    INSERT INTO bm_billing_entries
      (id, invoice_key, value_date, order_id, orderline_id, sku, designation, amount, currency, statement_ref, dedupe_key)
    VALUES (${id}, 'manual_reimbursement', ${valueDate}, ${orderId}, NULL, NULL, 'Seller Compensation Reimbursement', ${amt}, 'USD', 'manual', ${'manual|' + id})`

  // Recompute the order's marketplace fees so the reimbursement flows into profit.
  const order = await prisma.order.findFirst({ where: { amazonOrderId: orderId, orderSource: 'backmarket' }, select: { id: true } })
  if (order) {
    const feeKeys = [...FEE_KEYS]
    const rows = await prisma.$queryRaw<{ net: number | null }[]>`
      SELECT SUM(amount)::float8 AS net FROM bm_billing_entries
      WHERE order_id = ${orderId} AND invoice_key = ANY(${feeKeys}::text[])`
    await prisma.order.update({
      where: { id: order.id },
      data: { marketplaceCommission: round2(-(rows[0]?.net ?? 0)), commissionSyncedAt: new Date() },
    })
  }

  return NextResponse.json({ ok: true, orderExists: !!order, amount: amt })
}
