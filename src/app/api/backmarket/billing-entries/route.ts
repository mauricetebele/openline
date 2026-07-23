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
  const page = Math.max(1, parseInt(sp.get('page') ?? '1', 10) || 1)
  const pageSize = Math.min(200, Math.max(1, parseInt(sp.get('pageSize') ?? '100', 10) || 100))
  const offset = (page - 1) * pageSize

  const where = search
    ? Prisma.sql`WHERE order_id = ${search} OR order_id ILIKE ${'%' + search + '%'} OR sku ILIKE ${'%' + search + '%'} OR invoice_key ILIKE ${'%' + search + '%'}`
    : Prisma.empty

  const [rows, countRows, sumRows] = await Promise.all([
    prisma.$queryRaw<Entry[]>`
      SELECT id, invoice_key, value_date, order_id, sku, designation, amount::float8 AS amount, currency, statement_ref
      FROM bm_billing_entries
      ${where}
      ORDER BY value_date DESC NULLS LAST, order_id
      LIMIT ${pageSize} OFFSET ${offset}`,
    prisma.$queryRaw<{ total: bigint }[]>`SELECT COUNT(*)::bigint AS total FROM bm_billing_entries ${where}`,
    prisma.$queryRaw<{ amount_sum: number | null }[]>`SELECT SUM(amount)::float8 AS amount_sum FROM bm_billing_entries ${where}`,
  ])

  return NextResponse.json({
    data: rows,
    total: Number(countRows[0]?.total ?? 0),
    amountSum: sumRows[0]?.amount_sum ?? 0,
    page,
    pageSize,
  })
}
