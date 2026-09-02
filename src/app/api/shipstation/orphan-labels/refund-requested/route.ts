/**
 * POST /api/shipstation/orphan-labels/refund-requested
 * Body: { shipmentId, trackingNumber?, orderNumber?, cost?, undo? }
 *
 * Records (or clears) a "refund requested" flag for an orphaned ShipStation
 * label, persisted as an audit event keyed by shipmentId. The reconciliation
 * endpoint annotates each orphan with this flag.
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'
import { logAuditEvent } from '@/lib/audit'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const shipmentId = body?.shipmentId
  if (shipmentId == null) return NextResponse.json({ error: 'shipmentId is required' }, { status: 400 })
  const id = String(shipmentId)

  if (body?.undo) {
    // Clear the flag by removing prior refund_requested events for this shipment.
    await prisma.auditEvent.deleteMany({
      where: { entityType: 'orphanLabel', action: 'refund_requested', entityId: id },
    })
    return NextResponse.json({ success: true, refundRequested: false })
  }

  // Idempotent: don't stack duplicate flags.
  const existing = await prisma.auditEvent.findFirst({
    where: { entityType: 'orphanLabel', action: 'refund_requested', entityId: id },
    select: { id: true },
  })
  if (!existing) {
    await logAuditEvent({
      entityType: 'orphanLabel',
      entityId: id,
      action: 'refund_requested',
      before: {
        shipmentId,
        trackingNumber: body?.trackingNumber ?? null,
        orderNumber: body?.orderNumber ?? null,
        cost: body?.cost ?? null,
      },
      actorId: user.dbId,
      actorLabel: user.email,
    }).catch(e => console.error('[orphan refund-requested] audit failed:', e))
  }

  return NextResponse.json({ success: true, refundRequested: true })
}
