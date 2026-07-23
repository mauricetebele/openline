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
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

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
  if (search) conds.push(Prisma.sql`(order_id = ${search} OR orderline_id = ${search} OR order_id ILIKE ${'%' + search + '%'} OR orderline_id ILIKE ${'%' + search + '%'} OR sku ILIKE ${'%' + search + '%'} OR invoice_key ILIKE ${'%' + search + '%'})`)
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

  return NextResponse.json({
    data: rows,
    total: Number(countRows[0]?.total ?? 0),
    amountSum: sumRows[0]?.amount_sum ?? 0,
    types: typeRows.map(t => t.invoice_key),
    page,
    pageSize,
  })
}
