/**
 * GET /api/repair-orders/[id]/tracking
 * Live UPS/FedEx tracking status for EVERY parcel (box) on the outbound + inbound
 * shipments — a multi-piece shipment has several tracking numbers.
 * Returns { outbound: Status[], inbound: Status[] }.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/get-auth-user'
import { prisma } from '@/lib/prisma'
import { getCarrierStatus } from '@/lib/ups-tracking'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

function nums(csv: string | null): string[] {
  return (csv ?? '').split(',').map(t => t.trim()).filter(Boolean)
}

async function statuses(csv: string | null) {
  const tns = nums(csv)
  return Promise.all(tns.map(async (tn) => {
    try {
      const r = await getCarrierStatus(tn)
      return { trackingNumber: tn, status: r.status, deliveredAt: r.deliveredAt, estimatedDelivery: r.estimatedDelivery, error: null as string | null }
    } catch (e) {
      return { trackingNumber: tn, status: null, deliveredAt: null, estimatedDelivery: null, error: e instanceof Error ? e.message : 'Tracking lookup failed' }
    }
  }))
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const order = await prisma.repairOrder.findUnique({
    where: { id: params.id },
    select: { outboundTracking: true, inboundTracking: true },
  })
  if (!order) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const [outbound, inbound] = await Promise.all([statuses(order.outboundTracking), statuses(order.inboundTracking)])
  return NextResponse.json({ outbound, inbound })
}
