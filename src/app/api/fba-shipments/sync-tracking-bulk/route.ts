/**
 * POST /api/fba-shipments/sync-tracking-bulk
 *
 * Bulk per-box tracking sync for FBA shipments. Targets are resolved from either
 * an explicit list of shipment IDs OR a date range of SHIPPED shipments.
 *
 * Body: { shipmentIds?: string[] }  — sync these specific shipments, or
 *       { startDate: string, endDate: string }  — sync all SHIPPED shipments whose
 *          updatedAt falls in [startDate 00:00Z, endDate 23:59Z]
 *
 * Returns: { shipments, updatedBoxes, shipmentsWithTracking, results: [...] }
 */
import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/get-auth-user'
import { prisma } from '@/lib/prisma'
import { syncFbaTracking } from '@/lib/amazon/fba-tracking'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

const MAX_SHIPMENTS = 200
const CONCURRENCY = 3

export async function POST(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: unknown
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }) }
  const { shipmentIds, startDate, endDate } = body as { shipmentIds?: unknown; startDate?: unknown; endDate?: unknown }

  // Resolve the target shipment IDs.
  let ids: string[] = []
  if (Array.isArray(shipmentIds) && shipmentIds.length > 0) {
    const requested = shipmentIds.filter((x): x is string => typeof x === 'string' && x.length > 0)
    const rows = await prisma.fbaShipment.findMany({
      where: { id: { in: requested }, status: 'SHIPPED' },
      select: { id: true },
    })
    ids = rows.map(r => r.id)
  } else if (typeof startDate === 'string' && typeof endDate === 'string') {
    const start = new Date(startDate + 'T00:00:00.000Z')
    const end = new Date(endDate + 'T23:59:59.999Z')
    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      return NextResponse.json({ error: 'Invalid date range' }, { status: 400 })
    }
    const rows = await prisma.fbaShipment.findMany({
      where: { status: 'SHIPPED', updatedAt: { gte: start, lte: end } },
      select: { id: true },
      orderBy: { updatedAt: 'desc' },
    })
    ids = rows.map(r => r.id)
  } else {
    return NextResponse.json({ error: 'Provide shipmentIds or a startDate/endDate range' }, { status: 400 })
  }

  if (ids.length === 0) return NextResponse.json({ shipments: 0, updatedBoxes: 0, shipmentsWithTracking: 0, results: [] })

  const capped = ids.slice(0, MAX_SHIPMENTS)
  const results: Array<{ id: string; updated: number; total: number; tracked: number; error?: string }> = []

  // Bounded-concurrency pool — SP-API is rate-limited, so keep it small.
  let idx = 0
  async function worker() {
    while (idx < capped.length) {
      const id = capped[idx++]
      try {
        const r = await syncFbaTracking(id)
        if ('error' in r) results.push({ id, updated: 0, total: 0, tracked: 0, error: r.error })
        else results.push({ id, updated: r.updated, total: r.total, tracked: r.tracked })
      } catch (e) {
        results.push({ id, updated: 0, total: 0, tracked: 0, error: e instanceof Error ? e.message : 'sync failed' })
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, capped.length) }, worker))

  const updatedBoxes = results.reduce((s, r) => s + r.updated, 0)
  const shipmentsWithTracking = results.filter(r => r.tracked > 0).length

  return NextResponse.json({
    shipments: capped.length,
    truncated: ids.length > capped.length ? ids.length - capped.length : 0,
    updatedBoxes,
    shipmentsWithTracking,
    results,
  })
}
