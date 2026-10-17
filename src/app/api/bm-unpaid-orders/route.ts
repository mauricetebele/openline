/**
 * GET /api/bm-unpaid-orders
 * Shipped Back Market orders with NO Back Market "payment" (sales) transaction
 * in the BM financials (bm_billing_entries). A `sales` entry is Back Market's
 * per-order payout/revenue line — its absence means we shipped but weren't paid.
 *
 * Excludes replacement orders (no payment is expected for a free replacement).
 * Newly-shipped orders commonly appear here until Back Market settles the payout,
 * so results carry the ship date + age so stale (overdue) ones stand out.
 */
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'

export const dynamic = 'force-dynamic'

interface Row {
  orderId: string
  olmNumber: number | null
  shippedAt: Date | null
  purchaseDate: Date
  orderTotal: number | null
  currency: string | null
  shipToName: string | null
}

export async function GET() {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const rows = await prisma.$queryRawUnsafe<Row[]>(`
    SELECT o."amazonOrderId" AS "orderId",
           o."olmNumber"     AS "olmNumber",
           o."shippedAt"     AS "shippedAt",
           o."purchaseDate"  AS "purchaseDate",
           o."orderTotal"::float8 AS "orderTotal",
           o."currency"      AS "currency",
           o."shipToName"    AS "shipToName"
    FROM orders o
    WHERE o."orderSource" = 'backmarket'
      AND o."workflowStatus" = 'SHIPPED'
      AND (o."isReplacement" IS NOT TRUE)
      AND NOT EXISTS (
        SELECT 1 FROM bm_billing_entries b
        WHERE b.order_id = o."amazonOrderId" AND b.invoice_key = 'sales'
      )
    ORDER BY COALESCE(o."shippedAt", o."purchaseDate") ASC
  `)

  const now = Date.now()
  const data = rows.map(r => {
    const shipped = r.shippedAt ?? r.purchaseDate
    const ageDays = Math.floor((now - new Date(shipped).getTime()) / 86_400_000)
    return {
      orderId: r.orderId,
      olmNumber: r.olmNumber,
      shippedAt: shipped,
      ageDays,
      orderTotal: r.orderTotal,
      currency: r.currency ?? 'USD',
      shipToName: r.shipToName,
    }
  })

  const totalOutstanding = data.reduce((s, r) => s + (r.orderTotal ?? 0), 0)
  return NextResponse.json({ count: data.length, totalOutstanding, rows: data })
}
