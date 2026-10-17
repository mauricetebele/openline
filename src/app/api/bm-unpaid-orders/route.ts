/**
 * GET /api/bm-unpaid-orders?tab=active|archived
 *   active   (default): shipped Back Market orders with NO Back Market "payment"
 *                       (sales) transaction in bm_billing_entries, excluding
 *                       replacements and entries the user has archived.
 *   archived:           orders the user moved to the Archived tab (regardless of
 *                       current payment state — the archive is a stable record).
 *
 * A `sales` entry is Back Market's per-order payout/revenue line; its absence
 * means we shipped but weren't paid. Each row carries its resolution note +
 * solved/archived state so the UI can show "Problem Solved" and "Archive".
 *
 * POST /api/bm-unpaid-orders  { orderId, action, note? }
 *   action = 'solve'     → record/update the note and stamp solvedAt
 *            'archive'    → move to the Archived tab
 *            'unarchive'  → restore to the active list
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'

export const dynamic = 'force-dynamic'

interface OrderRow {
  orderId: string
  olmNumber: number | null
  shippedAt: Date | null
  purchaseDate: Date
  orderTotal: number | null
  currency: string | null
  shipToName: string | null
}

function shape(r: OrderRow, res: { note: string | null; solvedAt: Date | null; archived: boolean; archivedAt: Date | null; updatedBy: string | null } | undefined, now: number) {
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
    note: res?.note ?? null,
    solvedAt: res?.solvedAt ?? null,
    archived: res?.archived ?? false,
    archivedAt: res?.archivedAt ?? null,
    updatedBy: res?.updatedBy ?? null,
  }
}

export async function GET(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const tab = req.nextUrl.searchParams.get('tab') === 'archived' ? 'archived' : 'active'
  const now = Date.now()

  if (tab === 'archived') {
    const resolutions = await prisma.bmUnpaidResolution.findMany({ where: { archived: true } })
    const ids = resolutions.map(r => r.orderId)
    const resByOrder = new Map(resolutions.map(r => [r.orderId, r]))
    if (ids.length === 0) return NextResponse.json({ tab, count: 0, totalOutstanding: 0, rows: [] })
    const orders = await prisma.$queryRawUnsafe<OrderRow[]>(`
      SELECT o."amazonOrderId" AS "orderId", o."olmNumber" AS "olmNumber", o."shippedAt" AS "shippedAt",
             o."purchaseDate" AS "purchaseDate", o."orderTotal"::float8 AS "orderTotal",
             o."currency" AS "currency", o."shipToName" AS "shipToName"
      FROM orders o
      WHERE o."orderSource" = 'backmarket' AND o."amazonOrderId" = ANY($1)`, ids)
    const rows = orders
      .map(o => shape(o, resByOrder.get(o.orderId), now))
      .sort((a, b) => (b.archivedAt?.getTime() ?? 0) - (a.archivedAt?.getTime() ?? 0))
    const totalOutstanding = rows.reduce((s, r) => s + (r.orderTotal ?? 0), 0)
    return NextResponse.json({ tab, count: rows.length, totalOutstanding, rows })
  }

  // active tab
  const orders = await prisma.$queryRawUnsafe<OrderRow[]>(`
    SELECT o."amazonOrderId" AS "orderId", o."olmNumber" AS "olmNumber", o."shippedAt" AS "shippedAt",
           o."purchaseDate" AS "purchaseDate", o."orderTotal"::float8 AS "orderTotal",
           o."currency" AS "currency", o."shipToName" AS "shipToName"
    FROM orders o
    WHERE o."orderSource" = 'backmarket' AND o."workflowStatus" = 'SHIPPED' AND (o."isReplacement" IS NOT TRUE)
      AND NOT EXISTS (
        SELECT 1 FROM bm_billing_entries b WHERE b.order_id = o."amazonOrderId" AND b.invoice_key = 'sales'
      )
    ORDER BY COALESCE(o."shippedAt", o."purchaseDate") ASC`)

  const resolutions = await prisma.bmUnpaidResolution.findMany({ where: { orderId: { in: orders.map(o => o.orderId) } } })
  const resByOrder = new Map(resolutions.map(r => [r.orderId, r]))

  const rows = orders
    .filter(o => !resByOrder.get(o.orderId)?.archived) // archived rows live in the Archived tab
    .map(o => shape(o, resByOrder.get(o.orderId), now))
  const totalOutstanding = rows.reduce((s, r) => s + (r.orderTotal ?? 0), 0)
  return NextResponse.json({ tab, count: rows.length, totalOutstanding, rows })
}

export async function POST(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => null) as { orderId?: string; action?: string; note?: string } | null
  const orderId = body?.orderId?.trim()
  const action = body?.action
  if (!orderId || !action) return NextResponse.json({ error: 'orderId and action are required' }, { status: 400 })

  const base = { orderId, updatedBy: user.email }
  let data: Record<string, unknown>
  if (action === 'solve') {
    const note = body?.note?.trim() || null
    data = { note, solvedAt: new Date() }
  } else if (action === 'archive') {
    data = { archived: true, archivedAt: new Date() }
  } else if (action === 'unarchive') {
    data = { archived: false, archivedAt: null }
  } else {
    return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 })
  }

  const saved = await prisma.bmUnpaidResolution.upsert({
    where: { orderId },
    create: { ...base, ...data },
    update: { ...base, ...data },
  })
  return NextResponse.json({ ok: true, resolution: saved })
}
