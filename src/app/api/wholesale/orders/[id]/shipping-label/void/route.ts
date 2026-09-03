/**
 * POST /api/wholesale/orders/[id]/shipping-label/void
 * Body: { shipmentId }
 *
 * Voids an entire shipment set. For multi-piece (MPS) shipments a single void
 * cancels the whole shipment — carriers can't void individual parcels — so all
 * pieces sharing the shipmentId are voided together.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/get-auth-user'
import { prisma } from '@/lib/prisma'
import { voidReturnLabel } from '@/lib/ups-tracking'
import { loadFedExCredentials, cancelShipment } from '@/lib/fedex/client'

export const dynamic = 'force-dynamic'

const FEDEX_CODES = new Set([
  'FEDEX_GROUND', 'GROUND_HOME_DELIVERY', 'FEDEX_EXPRESS_SAVER', 'FEDEX_2_DAY', 'FEDEX_2_DAY_AM',
  'STANDARD_OVERNIGHT', 'PRIORITY_OVERNIGHT', 'FIRST_OVERNIGHT', 'SMART_POST',
])

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const shipmentId = String(body?.shipmentId ?? '').trim()
  if (!shipmentId) return NextResponse.json({ error: 'shipmentId is required' }, { status: 400 })

  const rows = await prisma.returnLabel.findMany({
    where: { salesOrderId: params.id, shipmentId, voided: false },
  })
  if (rows.length === 0) return NextResponse.json({ error: 'No active label found for that shipment' }, { status: 404 })

  const primary = rows[0]
  const isFedEx = FEDEX_CODES.has(primary.serviceCode) || /fedex/i.test(primary.serviceLabel ?? '')

  try {
    if (isFedEx) {
      const creds = await loadFedExCredentials()
      if (!creds) return NextResponse.json({ error: 'FedEx credentials not configured' }, { status: 400 })
      await cancelShipment(creds, shipmentId)
    } else {
      await voidReturnLabel(shipmentId, primary.upsCredentialId ?? undefined)
    }
  } catch (err: unknown) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Void failed' }, { status: 502 })
  }

  await prisma.returnLabel.updateMany({
    where: { salesOrderId: params.id, shipmentId },
    data: { voided: true, voidedAt: new Date() },
  })

  // If the order's tracking reflected this (now-voided) shipment, clear it.
  const order = await prisma.salesOrder.findUnique({ where: { id: params.id }, select: { shipTracking: true } })
  const trackings = new Set([shipmentId, ...rows.map(r => r.trackingNumber)])
  if (order?.shipTracking && trackings.has(order.shipTracking)) {
    await prisma.salesOrder.update({
      where: { id: params.id },
      data: { shipCarrier: null, shipTracking: null, actualShippingCost: null },
    }).catch(() => {})
  }

  return NextResponse.json({ ok: true, voided: rows.length })
}
