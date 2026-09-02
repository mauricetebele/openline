/**
 * GET /api/shipstation/orphan-labels/voided-log
 * Returns the log of orphaned labels that were voided from this tool
 * (audit events: entityType 'orphanLabel', action 'voided'), newest first.
 */
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'

export const dynamic = 'force-dynamic'

export async function GET() {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const events = await prisma.auditEvent.findMany({
    where: { entityType: 'orphanLabel', action: 'voided' },
    orderBy: { timestamp: 'desc' },
    take: 500,
    select: { id: true, entityId: true, before: true, actorLabel: true, timestamp: true },
  })

  const rows = events.map(e => {
    const b = (e.before as { shipmentId?: number; trackingNumber?: string; orderNumber?: string; cost?: number } | null) ?? {}
    return {
      id: e.id,
      shipmentId: b.shipmentId ?? Number(e.entityId) ?? null,
      trackingNumber: b.trackingNumber ?? null,
      orderNumber: b.orderNumber ?? null,
      cost: b.cost ?? null,
      voidedBy: e.actorLabel,
      voidedAt: e.timestamp,
    }
  })

  const totalRefunded = Math.round(rows.reduce((s, r) => s + (r.cost ?? 0), 0) * 100) / 100
  return NextResponse.json({ count: rows.length, totalRefunded, rows })
}
